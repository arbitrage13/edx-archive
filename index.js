const path = require('path');
const fs = require('fs');
const sanitize = require("sanitize-filename");
const puppeteer = require('puppeteer');
const prompt = require('async-prompt');
const program = require('commander');
const retry = require('async-retry');
const PromisePool = require('es6-promise-pool');


function parseFormat(value, previous) {
  if (!["pdf", "png"].includes(value)) {
    console.log(`invalid format: ${value}`);
    process.exit(1);
  }
  return value;
}

async function getConfiguration() {
  function parseInteger(v) { return parseInt(v); }
  program
    .arguments('<course_url>')
    .requiredOption('-u, --user <email>', 'edx login (email)')
    .requiredOption('-p, --password <password>', 'edx password')
    .option('-o, --output <directory>', 'output directory', 'Archive')
    .option('-f, --format <format>', 'pdf or png', parseFormat, 'pdf')
    .option('-r, --retries <retries>', 'number of attempts in case of failure', parseInteger, 3)
    .option('-d, --delay <seconds>', 'delay before saving page', parseInteger, 1)
    .option('-c, --concurrency <number>', 'number of pages to save in parallel', parseInteger, 4)
    .option('--debug', 'output extra debugging', false)
    .parse(process.argv);

  if (program.args.length !== 1) {
    program.help();
  }

  const configuration = Object.assign({}, program.opts());

  configuration.courseUrl = program.args[0];

  return configuration;
}

async function openPage(url, browser, configuration) {
  const page = await browser.newPage();
  await page.goto(url);
  return page;
}

async function loginBrowser(browser, configuration) {
  const page = await openPage('https://courses.edx.org/login', browser, configuration);
  await page.type('#login-email', configuration.user);
  await page.type('#login-password', configuration.password);
  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('.login-button'),
  ]);
  await page.close();

  if (configuration.debug) {
    console.log(`Logged in. Response status: ${response.status()}`);
  }
}

async function getPages(browser, configuration) {
  const page = await openPage(configuration.courseUrl, browser, configuration);

  const pages = await page.evaluate(() => {
    return $("a.outline-item").map(function(i, e) {
      return { "index": i, "url": e.href };
    }).toArray();
  });

  await page.close();

  if (configuration.debug) {
    console.log("Fetched pages:");
    console.log(pages);
  }

  return pages;
}

async function savePage(pageData, page, configuration) {
  const filename = path.join(configuration.output, `${pageData.index + 1} - ${pageData.title}`);

  if (configuration.debug) {
    console.log(`Saving page: ${pageData.url} as: ${filename}`);
  }

  if (!fs.existsSync(configuration.output)) {
      fs.mkdirSync(configuration.output);
  }

  if (configuration.format === "png") {
    await page.screenshot({ path: filename + '.png', fullPage: true });
  }
  if (configuration.format === "pdf") {
    await page.pdf({ path: filename + '.pdf' });
  }
}

function prettifyPage() {
  $(".show").trigger("click");
  $(".hideshowbottom").trigger("click");
  $(".discussion-show.shown").trigger("click");
  $(".discussion-module").hide();
  $("header").hide();
  $("#footer-edx-v3").hide();
  $(".course-tabs").hide();
  $(".course-expiration-message").hide();
  $("#frontend-component-cookie-policy-banner").hide();
  $(".sequence-bottom").hide();
  $(".sequence-nav").hide();
  $(".nav-utilities").hide();
  $(".course-license").hide();
  $(".bookmark-button-wrapper").hide();
  $(".subtitles").hide();
  $(".video-wrapper").hide();
}

function buildTitle(breadcumbs) {
  return sanitize(breadcumbs)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(Course\s)/, "");
}

function waitForMathJax() {
  return new Promise(function(resolve, reject) {
    try {
      // TODO this might be unreliable. Try to find a better way to detect
      // whether math has been processed
      MathJax.Hub.Queue(() => { resolve(); });
    } catch (e) {
      reject(e);
    }
  });
}

async function processPage(pageData, browser, configuration) {
  const page = await openPage(pageData.url, browser, configuration);

  pageData.title = buildTitle(await page.evaluate(() => {
    return $(".breadcrumbs").first().text();
  }));

  await page.evaluate(prettifyPage);

  await page.evaluate(waitForMathJax)

  await page.waitFor(configuration.delay * 1000);

  await savePage(pageData, page, configuration);

  await page.close();
}

async function main() {
  try {
    // build configuration
    const configuration = await getConfiguration();
    if (configuration.debug) {
      console.log("Configuration:");
      console.log(configuration);
    }

    // log in browser
    const browser = await puppeteer.launch();
    await loginBrowser(browser, configuration);

    // build list of pages that should be saved
    const pages = await retry(async () => {
      return await getPages(browser, configuration);
    }, {
      retries: configuration.retries,
      onRetry: () => { console.log("Failed to fetch pages. Retrying."); }
    });

    // process pages
    const jobGenerator = function * () {
      for (const pageData of pages) {
        console.log(`Processing page: ${pageData.url}.`);
        yield retry(async () => {
          return await processPage(pageData, browser, configuration);
        }, {
          retries: configuration.retries,
          onRetry: () => { console.log(`Failed to process page: ${pageData.url}. Retrying.`); }
        });
      }
    }
    const pool = new PromisePool(jobGenerator, configuration.concurrency);
    await pool.start();

    //
    console.log("Done.");
    await browser.close();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}


main();
