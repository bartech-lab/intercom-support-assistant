'use strict';

const { objectSource } = require('../../tools/validate-signatures');

const BANNER_LANGUAGES = ['english', 'german', 'italian', 'french', 'portuguese', 'spanish', 'dutch'];

function bannerFixture(name, host, expires) {
  const banner = {};
  for (const language of BANNER_LANGUAGES) {
    banner[language] = `📍${name} spring offer in ${language}. See <a href='https://${host}/offers/spring' target='_blank'>SPRING OFFER</a> now!`;
  }
  banner.expires = expires;
  return banner;
}

const BANNERS = {
  'Brightwell': bannerFixture('Brightwell', 'www.brightwell.example', '2026-09-22'),
  'Alderpoint': bannerFixture('Alderpoint', 'alderpoint.example', '2026-09-22'),
  'Kestrel Kids': bannerFixture('Kestrel Kids', 'kestrel-kids.example', '2026-09-28')
};

function bannersSource(banners) {
  const entries = Object.entries(banners).map(([name, banner]) => {
    const lines = Object.entries(banner).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`);
    return `  ${JSON.stringify(name)}: {\n${lines.join(',\n')}\n  }`;
  });
  return `{\n${entries.join(',\n')}\n}`;
}

function configWithBanners(content, banners = BANNERS) {
  const source = objectSource(content, 'promotionalBanners');
  return content.replace(source, `const promotionalBanners = ${bannersSource(banners)}`);
}

function injectBanners(window, banners = BANNERS) {
  let config;
  Object.defineProperty(window, 'ISA_INTERCOM_CONFIG', {
    configurable: true,
    get() { return config; },
    set(value) { config = { ...value, promotionalBanners: JSON.parse(JSON.stringify(banners)) }; }
  });
}

module.exports = { BANNERS, BANNER_LANGUAGES, bannerFixture, bannersSource, configWithBanners, injectBanners };
