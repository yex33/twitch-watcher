require('dotenv').config();
const puppeteer = require('puppeteer-core');
const dayjs = require('dayjs');
const cheerio = require('cheerio');
var fs = require('fs');
const inquirer = require('./input');
const treekill = require('tree-kill');

var run = true;
var firstRun = true;
var cookie = null;
var streamers = null;
// ========================================== CONFIG SECTION =================================================================
const configPath = './config.json'
const screenshotFolder = './screenshots/';
const baseUrl = 'https://www.twitch.tv/';
const inventoryUrl = `${baseUrl}drops/inventory`;

const userAgent = (process.env.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
const streamersUrl = (process.env.streamersUrl || 'https://www.twitch.tv/directory/game/VALORANT?tl=c2542d6d-cd10-4532-919b-3d19f30a768b');

const scrollDelay = (Number(process.env.scrollDelay) || 2000);
const scrollTimes = (Number(process.env.scrollTimes) || 5);

const minWatching = (Number(process.env.minWatching) || 15); // Minutes
const maxWatching = (Number(process.env.maxWatching) || 30); //Minutes

const noChannelFoundWait = (Number(process.env.noChannelFoundWait) || 5); // Minutes

const checkForDrops = (process.env.checkForDrops || true);

const streamerListRefresh = (Number(process.env.streamerListRefresh) || 1);
const streamerListRefreshUnit = (process.env.streamerListRefreshUnit || 'hour'); //https://day.js.org/docs/en/manipulate/add

const channelsWithPriority = process.env.channelsWithPriority ? process.env.channelsWithPriority.split(",") : [];
const watchAlwaysTopStreamer = (process.env.watchAlwaysTopStreamer || false);

const showBrowser = false; // false state equ headless mode;
const proxy = (process.env.proxy || ""); // "ip:port" By https://github.com/Jan710
const proxyAuth = (process.env.proxyAuth || "");

const browserScreenshot = (process.env.browserScreenshot || false);

const browserClean = 1;
const browserCleanUnit = 'hour';

var browserConfig = {
  headless: !showBrowser,
  args: [
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // For maximum memory savings
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--blink-settings=imagesEnabled=false' // Disable images to save data/memory
  ],
  // Reduce the initial rendering load
  defaultViewport: {
    width: 600,
    height: 800
  }
}; //https://github.com/D3vl0per/Valorant-watcher/issues/24

const cookiePolicyQuery = 'button[data-a-target="consent-banner-accept"]';
const matureContentQuery = 'button[data-a-target="player-overlay-mature-accept"]';
const oldChannelsQuery ='a[data-a-target="preview-card-image-link"]';
const channelsQuery = 'div[class="ScTextWrapper-sc-10mto54-1 fzKxJT"] > a[class="ScCoreLink-sc-16kq0mq-0 fytYW preview-card-channel-link tw-link"]';
const streamPauseQuery = 'button[data-a-target="player-play-pause-button"]';
const collapseChatQuery = 'button[aria-label="Collapse Chat"]';
const streamSettingsQuery = 'div[class="Layout-sc-1xcs6mc-0 video-ref"] button[data-a-target="player-settings-button"]';
const streamQualitySettingQuery = '[data-a-target="player-settings-menu-item-quality"]';
const streamQualityQuery = 'input[data-a-target="tw-radio"]';
const campaignInProgressDropClaimQuery = '//button[.//div[text()="Claim Now"]]';

// ========================================== CONFIG SECTION =================================================================



async function viewRandomPage(browser, page) {
  var streamer_last_refresh = dayjs().add(streamerListRefresh, streamerListRefreshUnit);
  var browser_last_refresh = dayjs().add(browserClean, browserCleanUnit);
  while (run) {
    try {
      if (dayjs(browser_last_refresh).isBefore(dayjs())) {
        var newSpawn = await cleanup(browser, page);
        browser = newSpawn.browser;
        page = newSpawn.page;
        firstRun = true;
        browser_last_refresh = dayjs().add(browserClean, browserCleanUnit);
      }

      if (dayjs(streamer_last_refresh).isBefore(dayjs())) {
        await getAllStreamer(page); //Call getAllStreamer function and refresh the list
        streamer_last_refresh = dayjs().add(streamerListRefresh, streamerListRefreshUnit); //https://github.com/D3vl0per/Valorant-watcher/issues/25
      }

      let watch;

      if (watchAlwaysTopStreamer) {
        watch = streamers[0];
      } else {
        watch = streamers[getRandomInt(0, streamers.length - 1)]; //https://github.com/D3vl0per/Valorant-watcher/issues/27
      }

      if (channelsWithPriority.length > 0) {
        for (let i = 0; i < channelsWithPriority.length; i++) {
          if (streamers.includes(channelsWithPriority[i])) {
            watch = channelsWithPriority[i];
            break;
          }
        }
      }

      if (checkForDrops) {
        await claimDropsIfAny(page);
      }

      if (!watch) {
        console.log(`❌ No channels available, retrying in ${noChannelFoundWait} minutes...`)
        await page.waitFor(noChannelFoundWait * 60 * 1000);
      }
      else {

        var sleep = getRandomInt(minWatching, maxWatching) * 60000; //Set watuching timer

        console.log('\n🔗 Now watching streamer: ', baseUrl + watch);

        await page.goto(baseUrl + watch, {
          "waitUntil": "networkidle2"
        }); //https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagegobackoptions
        console.log('✅ Stream loaded!');
        await clickWhenExist(page, cookiePolicyQuery);
        await clickWhenExist(page, matureContentQuery); //Click on accept button

        if (firstRun) {
          console.log('🔧 Setting lowest possible resolution..');
          await clickWhenExist(page, streamPauseQuery);

          await clickWhenExist(page, collapseChatQuery);
          await clickWhenExist(page, streamSettingsQuery);

          await clickWhenExist(page, streamQualitySettingQuery);
          await page.waitFor(streamQualityQuery);

          var resolution = await queryOnWebsite(page, streamQualityQuery);
          resolution = resolution[resolution.length - 1].attribs.id;
          await page.evaluate((resolution) => {
            document.getElementById(resolution).click();
          }, resolution);

          await clickWhenExist(page, streamPauseQuery);

          // await page.keyboard.press('m'); //For unmute
          firstRun = false;
        }


        if (browserScreenshot) {
          await page.waitFor(1000);
          fs.access(screenshotFolder, error => {
            if (error) {
              fs.promises.mkdir(screenshotFolder);
            }
          });
          await page.screenshot({
            path: `${screenshotFolder}${watch}.png`
          });
          console.log(`📸 Screenshot created: ${watch}.png`);
        }

        console.log(`🕒 Time: ${dayjs().format('HH:mm:ss')}`);
        console.log(`💤 Watching stream for ${sleep / 60000} minutes\n`);

        await page.waitFor(sleep);
      }
    } catch (e) {
      console.log('🤬 Error: ', e);
      console.log('Please visit the discord channel to receive help: https://discord.gg/s8AH4aZ');
    }
  }
}

async function claimDropsIfAny(page) {
  console.log('🔎 Checking for drops...');

  await page.goto(inventoryUrl, {
    "waitUntil": "networkidle0"
  }); //https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagegobackoptions

  var claimableDrops = await page.$x(campaignInProgressDropClaimQuery);
  if (claimableDrops.length > 0) {
    console.log(`🔎 ${claimableDrops.length} drop(s) found!`);
    for (const drop of claimableDrops) {
      await page.waitFor(5000);
      await drop.click();
      await page.waitFor(5000);
    }
    var dropsLeft = await page.$x(campaignInProgressDropClaimQuery);
    if (dropsLeft.length > 0) {
      console.log(`Something went wrong, ${dropsLeft.length} drop(s) unclaimed.`);
    }
    else {
      console.log(`✅ ${claimableDrops.length} drop(s) claimed!`);
    }
  }
}

async function readLoginData() {
  const cookie = [{
    "domain": ".twitch.tv",
    "hostOnly": false,
    "httpOnly": false,
    "name": "auth-token",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": "0",
    "id": 1
  }];
  console.log('🔎 Checking environment token...');

  if (process.env.token) {
    console.log('✅ Token found in environment variables.');

    if (proxy) browserConfig.args.push('--proxy-server=' + proxy);

    // Set executablePath for the Chromium installed in the Docker container
    browserConfig.executablePath = '/usr/bin/chromium'; 
    cookie[0].value = process.env.token;

    return cookie;
  } else if (fs.existsSync(configPath)) {
    // Keep local config reading for local runs if you need it
    console.log('✅ Json config found locally!');

    let configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'))

    if (proxy) browserConfig.args.push('--proxy-server=' + proxy);
    browserConfig.executablePath = configFile.exec;
    cookie[0].value = configFile.token;

    return cookie;
  } else {
    console.log('❌ No token found! Prompting for input...');
  }
}



async function spawnBrowser() {
  console.log("=========================");
  console.log('📱 Launching browser...');
  var browser = await puppeteer.launch(browserConfig);
  var page = await browser.newPage();

  console.log('🔧 Setting User-Agent...');
  await page.setUserAgent(userAgent); //Set userAgent

  console.log('🔧 Setting auth token...');
  await page.setCookie(...cookie); //Set cookie

  console.log('🔧 Setting local storage options...');
  await page.evaluateOnNewDocument (() => {
      localStorage.setItem('browse-preview.show-preview', 'false');
    });
  
  console.log('⏰ Setting timeouts...');
  await page.setDefaultNavigationTimeout(process.env.timeout || 0);
  await page.setDefaultTimeout(process.env.timeout || 0);

  if (proxyAuth) {
    await page.setExtraHTTPHeaders({
      'Proxy-Authorization': 'Basic ' + Buffer.from(proxyAuth).toString('base64')
    })
  }

  return {
    browser,
    page
  };
}



async function getAllStreamer(page) {
  console.log("=========================");
  await page.goto(streamersUrl, {
    "waitUntil": "networkidle0"
  });
  console.log('🔐 Checking login...');
  await checkLogin(page);
  console.log('📡 Checking active streamers...');
  await scroll(page, scrollTimes);
  let jquery = await queryOnWebsite(page, channelsQuery);
  if (jquery.length == 0) {
    console.log('🛑 No active streamers found! Retrying with old channels query');
    jquery =  await queryOnWebsite(page, oldChannelsQuery);
  }
  streamers = null;
  streamers = new Array();

  console.log('🧹 Filtering out html codes...');
  for (var i = 0; i < jquery.length; i++) {
    streamers[i] = jquery[i].attribs.href.split("/")[1];
  }
  return;
}



async function checkLogin(page) {
  let cookieSetByServer = await page.cookies();
  for (var i = 0; i < cookieSetByServer.length; i++) {
    if (cookieSetByServer[i].name == 'twilight-user') {
      console.log('✅ Login successful!');
      return true;
    }
  }
  console.log('🛑 Login failed!');
  console.log('🔑 Invalid token!');
  console.log('\nPleas ensure that you have a valid twitch auth-token.\nhttps://github.com/D3vl0per/Valorant-watcher#how-token-does-it-look-like');
  if (!process.env.token) {
    fs.unlinkSync(configPath);
  }
  process.exit();
}



async function scroll(page, times) {
  console.log('🔨 Emulating scrolling...');

  for (var i = 0; i < times; i++) {
    await page.evaluate(async (page) => {
      var x = document.getElementsByClassName("scrollable-trigger__wrapper");
      if (x.length > 0) { // there will be no scroll if there are no active streams
        x[0].scrollIntoView();
      }
    });
    await page.waitFor(scrollDelay);
  }
  return;
}



function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}



async function clickWhenExist(page, query, clickCount = 1) {
  let result = await queryOnWebsite(page, query);

  try {
    await page.waitForSelector(query, { visible: true, timeout: 5000 });
    await page.click(query, {delay: 500, clickCount});
    await page.waitFor(500);
    return true;
  } catch (e) { 
    console.log(`Failed to click on query: ${query}, ${e.message}`)
    return false
  }
}



async function queryOnWebsite(page, query) {
  let bodyHTML = await page.evaluate(() => document.body.innerHTML);
  let $ = cheerio.load(bodyHTML);
  const jquery = $(query);
  return jquery;
}



async function cleanup(browser, page) {
  const pages = await browser.pages();
  await pages.map((page) => page.close());
  await treekill(browser.process().pid, 'SIGKILL');
  //await browser.close();
  return await spawnBrowser();
}



async function killBrowser(browser, page) {
  const pages = await browser.pages();
  await pages.map((page) => page.close());
  treekill(browser.process().pid, 'SIGKILL');
  return;
}



async function shutDown() {
  console.log("\n👋Bye Bye👋");
  run = false;
  process.exit();
}



async function main() {
  console.clear();
  console.log("=========================");
  cookie = await readLoginData();
  var {
    browser,
    page
  } = await spawnBrowser();
  await getAllStreamer(page);
  console.log("=========================");
  console.log('🔭 Running watcher...');
  await viewRandomPage(browser, page);
};

main();

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
