const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const prompt = require('async-prompt');
const program = require('commander');
const retry = require('async-retry')


function parseFormat(value, previous) {
  if (!["pdf", "png"].includes(value)) {
    console.log(`invalid format: ${value}`);
    process.exit(1);
  }
  return value;
}

async function getConfiguration() {
  program
    .arguments('<course_url>')
    .requiredOption('-u, --user <email>', 'edx login (email)')
    .requiredOption('-p, --password <password>', 'edx password')
    .option('-o, --output <directory>', 'output directory', 'Archive')
    .option('-f, --format <format>', 'pdf or png', parseFormat, 'pdf')
    .option('-r, --retries <retries>', 'number of attempts in case of failure', (v) => { return parseInt(v); }, 2)
    .option('--delay <seconds>', 'delay before saving page', 5)
    .option('-d, --debug', 'output extra debugging', false)
    .parse(process.argv);

  if (program.args.length !== 1) {
    program.help();
  }

  const configuration = Object.assign({}, program.opts());

  configuration.courseUrl = program.args[0];

  return configuration;
}

async function loginBrowser(browser, configuration) {
  const page = await browser.newPage();
  await page.goto('https://courses.edx.org/login');
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
  const page = await browser.newPage()
  await page.goto(configuration.courseUrl);

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
  if (!fs.existsSync(configuration.output)) {
      fs.mkdirSync(configuration.output);
  }

  const filename = path.join(configuration.output, `${pageData.index + 1} - ${pageData.title}`);

  if (configuration.format === "png") {
    await page.screenshot({ path: filename + '.png', fullPage: true });
  }
  if (configuration.format === "pdf") {
    await page.pdf({ path: filename + '.pdf' });
  }
}

async function processPage(pageData, browser, configuration) {
  const page = await browser.newPage()
  await page.goto(pageData.url);

  pageData.title = await page.evaluate(() => {
    return $(".breadcrumbs").first().text()
      .replace(/(\r\n|\n|\r|\:)/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(Course\s)/, "");
  });

  await page.evaluate(() => {
    $(".show").trigger("click");
    $(".hideshowbottom").trigger("click");
    $(".discussion-show.shown").trigger("click");
    $("#footer-edx-v3").hide();
    $(".course-expiration-message").hide();
    $("#frontend-component-cookie-policy-banner").hide();
  });

  await page.waitFor(configuration.delay);

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
    for (const pageData of pages) { // TODO
      console.log(`Processing page: ${pageData.url}.`);
      await retry(async () => {
        return await processPage(pageData, browser, configuration);
      }, {
        retries: configuration.retries,
        onRetry: () => { console.log(`Failed to process page: ${pageData.url}. Retrying.`); }
      });
    }

    //
    console.log("Done.");
    await browser.close();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}


main();
