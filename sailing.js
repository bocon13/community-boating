const https = require('https')
const storage = require('node-persist')
const cron = require('node-cron')
require('console-stamp')(console, { 
  format: ':date(yyyy/mm/dd HH:MM:ss.l)' 
})

// Pushover Config
const Pushover = require('pushover-notifications')
let push = new Pushover({
  user: process.env['PUSHOVER_USER'],
  token: process.env['PUSHOVER_TOKEN'],
})

// RSS Parser
const Parser = require('rss-parser');
let parser = new Parser();

// App Config
const PREV_COLOR_KEY = 'color'

/*
  Get the MIT Sailing weather report

  Example:
  {
    Time: '28.06.2021 17:05',
    'Outside Temperature': '91.7°F',
    'Inside Temperature': '95.2°F',
    'Wind Chill': '91.7°F',
    'Heat Index': '102.6°F',
    Dewpoint: '74.8°F',
    Humidity: '58%',
    Barometer: '1018.6 mbar',
    Wind: '12 mph from 225°',
    'Rain Rate': '0.00 in/hr'
  }
*/
async function getWeatherMIT() {
  let weather = {};
  let feed = await parser.parseURL('http://sailing.mit.edu/weather/weewx_rss.xml');
  feed.items.forEach(item => {
    if (item.title.startsWith('Weather Conditions'))
      item['content:encodedSnippet'].split('\n').forEach(entry => {
        const delim = entry.indexOf(':');
        weather[entry.substr(0, delim).trim()] = entry.substr(delim + 1).trim();
      });
  });
  console.log(weather);
  return weather;
}

// Send a push notification if the flag color has changed
async function sendNotification(color) {
  const previousColor = await storage.getItem(PREV_COLOR_KEY)
  if (previousColor === color) {
    console.log('same color: ' + color);
    return;
  }  // else...
  console.log('new color: ' + color)
  const weather = await getWeatherMIT()
  var msg = {
    title: `Community Boating Flag: ${color}`,
    message: `Wind: ${weather['Wind']}; Temp: ${weather['Outside Temperature']}`,
  }

  push.send(msg, async function(err, result) {
    if (err) {
      console.error(err)  // throw err
      return;
    }
    console.log(result);
    // TODO: check to ensure "status":1 in result
    // Save the state on success; otherwise, we'll retry next interval
    await storage.setItem(PREV_COLOR_KEY, color)
  })
}

// Check the current flag color
function getFlagStatus() {
  https.get('https://api.community-boating.org/api/flag', (res) => {
    if (res.statusCode != 200) {
      console.log('statusCode:', res.statusCode);
      console.log('headers:', res.headers);
      return false;
    }

    let data = '';
    res.on('data', (d) => {
      data += d;
    });
    res.on('end', () => {
      console.log(data)
      // TODO calling eval() is dangerous
      eval(data);  // var FLAG_COLOR = "Y"
      let color;
      switch(FLAG_COLOR) {
      case 'R':
        color = 'Red';
        break;
      case 'Y':
        color = 'Yellow';
        break;
      case 'G':
        color = 'Green';
        break;
      case 'C':
        color = 'Closed';
        break;
      default:
        color = `? (${FLAG_COLOR})`;
        break;
      }
      sendNotification(color);
    });
  }).on('error', (e) => {
    console.error(e);
  });  
}

async function start() {
  // Initialize the storage API
  await storage.init( /* options ... */ );
  // Run once now
  getFlagStatus();
  // Schedule check every 5 minutes from 7am to 9pm.
  // Wait 15 seconds after the minute because MIT's
  //   weather regenerates every 5 minutes at 0 seconds.
  cron.schedule('15 */5 7-21 * * *', getFlagStatus)
}

start()
