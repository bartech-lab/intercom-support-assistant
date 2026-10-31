'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { INTERCOM_LANGUAGE_SCRIPTS, loadExtension } = require('../support/helpers');
const fx = require('../support/fixtures');

const loadExtensionSubset = (html) => loadExtension(html, { scripts: INTERCOM_LANGUAGE_SCRIPTS });

const AGENT_REPLY = 'Hello, thank you for reaching out, best regards from the support team.';

function locationRow(country) {
  return fx.userDetailRow('Location', `<span class="truncate">${country}</span>`);
}

function detect({ text, quickReplies = [], attribute, location, brand }) {
  const conversationAttrs = [];
  if (attribute) conversationAttrs.push(fx.conversationAttrRow('language', 'Language', attribute));
  if (brand) conversationAttrs.push(fx.conversationAttrRow('brand', 'Brand', brand));

  const window = loadExtensionSubset(fx.inboxHtml({
    sidebar: fx.sidebarSection({ teamInbox: 'Support Brightwell', conversationAttrs }),
    userDetails: location ? fx.userDetailsSection([locationRow(location)]) : '',
    conversation: fx.conversationSpace({ customerText: [...quickReplies, text], agentText: AGENT_REPLY })
  }));

  return window.detectCustomerLanguage();
}

test('conflicting content still falls back to English', () => {
  const conflicting = {
    attribute: 'Portuguese',
    text: 'Bonjour, merci de votre aide, je voudrais savoir pourquoi ma commande a été annulée, veuillez répondre.'
  };
  assert.strictEqual(detect({ ...conflicting, attribute: null }), 'french', 'content is confidently French');
  assert.strictEqual(detect(conflicting), 'english', 'attribute says Portuguese, so neither wins');
});

test('an uncorroborated attribute loses to the location hint', () => {
  const italy = { location: 'Italy', brand: 'Brightwell', text: 'Inviato da iPhone 14 pro' };

  assert.strictEqual(detect({ ...italy, attribute: null }), 'italian', 'Italy alone gives italian');
  assert.strictEqual(
    detect({ ...italy, attribute: 'Brazilian Portuguese' }),
    'italian',
    'no Portuguese word or diacritic appears, so the attribute is discarded'
  );
});

test('one weak content hit still lets the attribute beat the location hint', () => {
  const corroborated = {
    attribute: 'Brazilian Portuguese',
    location: 'Italy',
    brand: 'Brightwell',
    text: 'Voce recebeu a foto'
  };

  assert.strictEqual(detect(corroborated), 'portuguese');
  assert.strictEqual(detect({ ...corroborated, attribute: 'Spanish' }), 'italian', 'Spanish has no hit in the same text');
});

test('a device footer corroborates its own language attribute', () => {
  const footers = [
    ['Italian', 'Germany', 'Inviato da iPhone', 'italian'],
    ['Italian', 'France', 'Inviato da Outlook per iOS', 'italian'],
    ['Portuguese', 'Germany', 'Enviado do meu iPhone', 'portuguese'],
    ['Spanish', 'France', 'Enviado desde mi iPhone', 'spanish'],
    ['French', 'Spain', 'Envoyé de mon iPhone', 'french'],
    ['German', 'Italy', 'Von meinem iPhone gesendet', 'german'],
    ['Dutch', 'Austria', 'Verzonden vanaf mijn iPhone', 'dutch']
  ];

  for (const [attribute, location, text, language] of footers) {
    assert.strictEqual(
      detect({ attribute, location, brand: 'Brightwell', text }),
      language,
      `${language} footer in ${location} must not lose to the location hint`
    );
  }
});

test('a diacritic alone corroborates its own language attribute against the location hint', () => {
  const umlaut = { attribute: 'German', location: 'Italy', brand: 'Brightwell', text: 'Jäger 2290' };

  assert.strictEqual(detect(umlaut), 'german');
  assert.strictEqual(detect({ ...umlaut, text: 'Jager 2290' }), 'italian', 'without the umlaut nothing corroborates German');
});

test('every signature language resolves on a realistic message', () => {
  const samples = [
    ['Italian', 'Italy', 'Inviato da iPhone', 'italian'],
    ['Italian', 'Italy', '--Inviato da Libero Mail', 'italian'],
    ['Portuguese', 'Portugal', 'Enviado do meu iPhone', 'portuguese'],
    ['Spanish', 'Spain', 'Enviado desde mi iPhone', 'spanish'],
    ['French', 'France', 'Bonjour je ne re\u00e7ois pas mon colis \u00e0 mon adresse, pourquoi ? Envoy\u00e9 de mon iPhone', 'french'],
    ['German', 'Austria', 'Bitte um R\u00fcckruf!! Von meinem iPhone gesendet', 'german'],
    ['Dutch', 'Netherlands', 'Kunt u mijn bestelling annuleren?! U heeft mij een pakket gestuurd dat ik niet heb besteld en ik heb het nog niet geopend', 'dutch'],
    ['Dutch', 'Netherlands', 'Hallo, ik wacht al een week op antwoord en heb ook geen bericht gekregen, wanneer kan ik het pakket verwachten', 'dutch']
  ];

  for (const [attribute, location, text, language] of samples) {
    assert.strictEqual(detect({ attribute, location, brand: 'Brightwell', text }), language, text.slice(0, 45));
  }
});

test('an unsupported language attribute still resolves to English', () => {
  const unsupported = [
    ['Swedish', null, 'Avbryt min best\u00e4llning, jag har ringt tv\u00e5 g\u00e5nger och ingen hj\u00e4lper mig'],
    ['Czech', null, 'Dobr\u00fd den, pros\u00edm v\u00e1s zru\u0161te mi objedn\u00e1vku, d\u011bkuji'],
    ['Greek', null, '\u03a3\u03b1\u03c2 \u03c0\u03b1\u03c1\u03b1\u03ba\u03b1\u03bb\u03ce \u03b1\u03ba\u03c5\u03c1\u03ce\u03c3\u03c4\u03b5 \u03c4\u03b7\u03bd \u03c0\u03b1\u03c1\u03b1\u03b3\u03b3\u03b5\u03bb\u03af\u03b1 \u03bc\u03bf\u03c5'],
    ['Turkish', 'Austria', 'Neden sipari\u015fimi g\u00f6remiyorum, l\u00fctfen yard\u0131m edin'],
    ['Romanian', 'Germany', 'Bun\u0103 ziua. De ce nu ajunge coletul meu la adres\u0103 ?']
  ];

  for (const [attribute, location, text] of unsupported) {
    assert.strictEqual(detect({ attribute, location, brand: 'Brightwell', text }), 'english', attribute);
  }
});

test('a Belgian francophone writing English keeps English', () => {
  const quebec = {
    attribute: 'English',
    location: 'Belgium',
    brand: 'Brightwell',
    text: 'Hello, could you tell me when the blue jacket will be back in stock? I would like to order it before the weekend '
      + 'because it is a birthday present for my sister. Solenne Envoy\u00e9 de mon iPhone'
  };

  assert.strictEqual(detect(quebec), 'english', 'an English body with a French footer');
  assert.strictEqual(detect({ ...quebec, attribute: null }), 'english', 'the French footer must not outvote an English body');
});

test('the Android device footers corroborate their language too', () => {
  const android = [
    ['Italian', 'Germany', 'Inviato dal mio Galaxy', 'italian'],
    ['Italian', 'Germany', 'Accetto il rimborso parziale\nInviato dal mio Galaxy', 'italian'],
    ['Italian', 'Germany', 'Richiedo l\u2019annullamento dell\u2019ordine Inviato da Outlook per Android', 'italian']
  ];

  for (const [attribute, location, text, language] of android) {
    assert.strictEqual(detect({ attribute, location, brand: 'Brightwell', text }), language, text.slice(0, 45));
  }
});

test('short Dutch survives a conflicting location', () => {
  const dutch = [
    ['Hallo, hoe kan ik mijn adres wijzigen?'],
    ['Goedemiddag, wanneer wordt mijn pakket bezorgd?'],
    ['Ik heb een probleem met de bestelpagina\nMet vriendelijke groet,\nSanne.'],
    ['hoi, is het pakket al onderweg? bedankt']
  ];

  for (const [text] of dutch) {
    assert.strictEqual(
      detect({ attribute: 'Dutch', location: 'Germany', brand: 'Brightwell', text }),
      'dutch',
      text.slice(0, 45)
    );
  }
});

test('a two-letter stopword cannot corroborate a contradicting attribute', () => {
  const italianFooter = { location: 'Italy', brand: 'Brightwell', text: 'Inviato da iPhone 14 pro' };

  for (const attribute of ['German', 'French', 'Spanish', 'Dutch', 'Brazilian Portuguese']) {
    assert.strictEqual(
      detect({ ...italianFooter, attribute }),
      'italian',
      `${attribute} must not survive on a short stopword alone`
    );
  }

  assert.strictEqual(
    detect({ location: 'Italy', brand: 'Brightwell', attribute: 'German', text: 'Guten Tag, wo ist meine Lieferung? Danke' }),
    'german',
    'real German content still keeps the German attribute'
  );
});

test('English bot quick-replies no longer suppress a foreign free-text block', () => {
  const routed = [
    [['Shipping', 'My orders', 'Talk to a person'], 'Boa tarde, quando chega a encomenda que fiz na semana passada?', 'portuguese'],
    [['Order', 'Back', 'Order', 'Waiting', 'Yes', 'Track my parcel'], "Bonjour, le colis n'est toujours pas arrivé chez moi", 'french']
  ];

  for (const [quickReplies, freeText, language] of routed) {
    assert.strictEqual(detect({ text: freeText }), language, `free text alone scores ${language}`);
    assert.strictEqual(detect({ text: freeText, quickReplies }), language, 'quick-replies no longer suppress it');
  }
});

test('genuine English keeps the predominantly-English guard', () => {
  const english = [
    'Hi, my son ordered a jacket or maybe my old order went through twice. No idea what happened. Please help me with the order on my profile.',
    'Hello, I placed an order two days ago and it is still pending. Can you please check my order? Thank you.',
    'This is the third time I contact support and no one answers. I want my parcel now or I will complain. My address is correct.',
    'Good morning, I did not receive the tracking number for the parcel you sent me. Could you check it please?',
    'Hi there, my parcel has not arrived yet. The tracking page shows an error when I open it. Can someone help?',
    'Please cancel my order. I do not want the jacket any more and I would like a response today. Thanks a lot.'
  ];

  for (const text of english) {
    assert.strictEqual(detect({ text }), 'english', text.slice(0, 45));
  }
});
