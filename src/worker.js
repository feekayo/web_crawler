const axios = require('axios');
const cheerio = require('cheerio');
const { parentPort } = require('worker_threads');
const { URL } = require('url');

parentPort.on('message', (data) => {
  fetch_url_link(data);
});

async function fetch_url_link({ url, worker_id }) {
  try {
    let response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);
    const links = $('a');
    if (links.length === 0) {
      parentPort.postMessage([]);
      return;
    }

    let urls = [];
    const domain = new URL(url).hostname;
    // Extract the urls from the links
    for (let link in links) {
      const href =
        links[link].attribs && links[link].attribs.href
          ? links[link].attribs.href
          : '';
      if (link_belongs_to_domain(domain, href)) {
        urls.push(href);
      }
    }
    parentPort.postMessage({
      result: urls,
      url,
      worker_id,
    });
  } catch (e) {
    console.log(`Error parsing url: ${url}`, e);
    process.exit(1);
  }
}

function link_belongs_to_domain(domain, link) {
  try {
    const link_domain = new URL(link).hostname;
    return link_domain === domain;
  } catch (e) {
    return false;
  }
}
