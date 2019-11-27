const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const prompt = require('async-prompt');
const program = require('commander');


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
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('.login-button'),
  ]);
  await page.close();
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
  const configuration = await getConfiguration();
  if (configuration.debug) {
    console.log("Configuration:");
    console.log(configuration);
  }

  const browser = await puppeteer.launch();
  await loginBrowser(browser, configuration);

  const pages = await getPages(browser, configuration);

  for (const pageData of pages.slice(50,51)) { // TODO
    await processPage(pageData, browser, configuration);
  }

  await browser.close();
}


main();
