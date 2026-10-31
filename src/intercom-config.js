(function () {
const excludedInboxes = [
  "Tier 2"
];

const alertInboxPattern = "^urgent\\b";

const alertableInboxesSeed = [
  { teamId: "900101", label: "Urgent Alderpoint", companies: ["Alderpoint"], featured: true },
  { teamId: "900102", label: "Urgent Brightwell", companies: ["Brightwell"], featured: true },
  { teamId: "900103", label: "Urgent Kids & Books", companies: ["Kestrel Kids", "Marlowe Books"] }
];

const retiredAlertInboxIds = ["900199"];

const promotionalBanners = {
};

const companies = {
  "Alderpoint": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f332.svg",
    english: "<br>--<br>Best regards<br>Maya Lindqvist<br>Customer Support @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Maya Lindqvist<br>Kundenservice @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>",
    french: "<br>--<br>Cordialement<br>Maya Lindqvist<br>Service client @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Maya Lindqvist<br>Assistenza clienti @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Maya Lindqvist<br>Apoio ao Cliente @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Maya Lindqvist<br>Atención al Cliente @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Maya Lindqvist<br>Klantenservice @ Alderpoint<br><a href='https://alderpoint.example/' target='_blank'>https://alderpoint.example/</a>"
  },
  "Brightwell": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f4a1.svg",
    english: "<br>--<br>Best regards<br>Tomás Rivera<br>Customer Support @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Tomás Rivera<br>Kundenservice @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>",
    french: "<br>--<br>Cordialement<br>Tomás Rivera<br>Service client @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Tomás Rivera<br>Assistenza clienti @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Tomás Rivera<br>Apoio ao Cliente @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Tomás Rivera<br>Atención al Cliente @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Tomás Rivera<br>Klantenservice @ Brightwell<br><a href='https://brightwell.example/' target='_blank'>https://brightwell.example/</a>"
  },
  "Kestrel Kids": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f985.svg",
    english: "<br>--<br>Best regards<br>Ines Okafor<br>Customer Support @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Ines Okafor<br>Kundenservice @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>",
    french: "<br>--<br>Cordialement<br>Ines Okafor<br>Service client @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Ines Okafor<br>Assistenza clienti @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Ines Okafor<br>Apoio ao Cliente @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Ines Okafor<br>Atención al Cliente @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Ines Okafor<br>Klantenservice @ Kestrel Kids<br><a href='https://kestrel-kids.example/' target='_blank'>https://kestrel-kids.example/</a>"
  },
  "Marlowe Books": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f4da.svg",
    english: "<br>--<br>Best regards<br>Jonah Pereira<br>Customer Support @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Jonah Pereira<br>Kundenservice @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>",
    french: "<br>--<br>Cordialement<br>Jonah Pereira<br>Service client @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Jonah Pereira<br>Assistenza clienti @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Jonah Pereira<br>Apoio ao Cliente @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Jonah Pereira<br>Atención al Cliente @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Jonah Pereira<br>Klantenservice @ Marlowe Books<br><a href='https://marlowe-books.example/' target='_blank'>https://marlowe-books.example/</a>"
  },
  "Fernhill": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f33f.svg",
    english: "<br>--<br>Best regards<br>Leila Haddad<br>Customer Support @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Leila Haddad<br>Kundenservice @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>",
    french: "<br>--<br>Cordialement<br>Leila Haddad<br>Service client @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Leila Haddad<br>Assistenza clienti @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Leila Haddad<br>Apoio ao Cliente @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Leila Haddad<br>Atención al Cliente @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Leila Haddad<br>Klantenservice @ Fernhill<br><a href='https://fernhill.example/' target='_blank'>https://fernhill.example/</a>"
  },
  "Quayside Fashion": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/2693.svg",
    english: "<br>--<br>Best regards<br>Oskar Nilsen<br>Customer Support @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Oskar Nilsen<br>Kundenservice @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>",
    french: "<br>--<br>Cordialement<br>Oskar Nilsen<br>Service client @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Oskar Nilsen<br>Assistenza clienti @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Oskar Nilsen<br>Apoio ao Cliente @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Oskar Nilsen<br>Atención al Cliente @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Oskar Nilsen<br>Klantenservice @ Quayside Fashion<br><a href='https://quayside-fashion.example/' target='_blank'>https://quayside-fashion.example/</a>"
  },
  "Orchard Kitchen": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f34e.svg",
    english: "<br>--<br>Best regards<br>Priya Raman<br>Customer Support @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Priya Raman<br>Kundenservice @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>",
    french: "<br>--<br>Cordialement<br>Priya Raman<br>Service client @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Priya Raman<br>Assistenza clienti @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Priya Raman<br>Apoio ao Cliente @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Priya Raman<br>Atención al Cliente @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Priya Raman<br>Klantenservice @ Orchard Kitchen<br><a href='https://orchard-kitchen.example/' target='_blank'>https://orchard-kitchen.example/</a>"
  },
  "Saltmarsh Crafts": {
    emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f3a8.svg",
    english: "<br>--<br>Best regards<br>Elena Duarte<br>Customer Support @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>",
    german: "<br>--<br>Viele Grüße<br>Elena Duarte<br>Kundenservice @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>",
    french: "<br>--<br>Cordialement<br>Elena Duarte<br>Service client @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>",
    italian: "<br>--<br>Cordiali saluti<br>Elena Duarte<br>Assistenza clienti @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>",
    portuguese: "<br>--<br>Com os melhores cumprimentos<br>Elena Duarte<br>Apoio ao Cliente @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>",
    spanish: "<br>--<br>Atentamente<br>Elena Duarte<br>Atención al Cliente @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>",
    dutch: "<br>--<br>Met vriendelijke groet<br>Elena Duarte<br>Klantenservice @ Saltmarsh Crafts<br><a href='https://saltmarsh-crafts.example/' target='_blank'>https://saltmarsh-crafts.example/</a>"
  }
};

const companySignatureLinkMap = {
  "Alderpoint": "https://alderpoint.example/",
  "Brightwell": "https://brightwell.example/",
  "Kestrel Kids": "https://kestrel-kids.example/",
  "Marlowe Books": "https://marlowe-books.example/",
  "Fernhill": "https://fernhill.example/",
  "Quayside Fashion": "https://quayside-fashion.example/",
  "Orchard Kitchen": "https://orchard-kitchen.example/",
  "Saltmarsh Crafts": "https://saltmarsh-crafts.example/"
};

const companyAliases = {
  "Alderpoint": ["alder", "alderpoint outdoor"],
  "Kestrel Kids": ["kestrel"],
  "Marlowe Books": ["marlowe"]
};

const teamSignature = {
  emoji: "https://js.intercomcdn.com/images/stickers/v2/svg/1f4ac.svg",
  english: "<br>--<br>Many thanks,<br>Support Desk",
  german: "<br>--<br>Viele Grüße,<br>Ihr Support-Team",
  french: "<br>--<br>Avec mes salutations,<br>L'équipe support",
  italian: "<br>--<br>Un saluto,<br>Il team di supporto",
  portuguese: "<br>--<br>Cumprimentos,<br>A equipa de suporte",
  spanish: "<br>--<br>Un saludo,<br>El equipo de soporte",
  dutch: "<br>--<br>Met vriendelijke groet,<br>Het supportteam"
};

const teamSignatureInboxes = [
  "Billing",
  "Returns"
];

const teamIdToCompany = {
  "900201": "Alderpoint",
  "900202": "Brightwell",
  "900203": "Kestrel Kids",
  "900204": "Marlowe Books",
  "900205": "Fernhill",
  "900206": "Quayside Fashion",
  "900207": "Orchard Kitchen",
  "900208": "Saltmarsh Crafts"
};

const greetingPools = {
  english: ["Best regards", "Many thanks", "All the best"],
  german: ["Viele Grüße", "Herzliche Grüße", "Schöne Grüße"],
  french: ["Cordialement", "Belle journée", "Avec mes salutations"],
  italian: ["Cordiali saluti", "Buona giornata", "Saluti dal team"],
  portuguese: ["Com os melhores cumprimentos", "Votos de um bom dia", "Saudações"],
  spanish: ["Atentamente", "Muchas gracias", "Que tenga un buen día"],
  dutch: ["Met vriendelijke groet", "Hartelijke groet", "Fijne dag"]
};

const senderFromEmailToInbox = {
  'help@alderpoint.example': 'Support Alderpoint',
  'help@brightwell.example': 'Support Brightwell',
  'help@kestrel-kids.example': 'Support Kestrel Kids',
  'help@marlowe-books.example': 'Support Marlowe Books',
  'help@fernhill.example': 'Support Fernhill',
  'help@quayside-fashion.example': 'Support Quayside Fashion',
  'help@orchard-kitchen.example': 'Support Orchard Kitchen',
  'help@saltmarsh-crafts.example': 'Support Saltmarsh Crafts'
};

const supportInboundLocalParts = ['support'];

window.ISA_INTERCOM_CONFIG = {
  excludedInboxes,
  alertInboxPattern,
  alertableInboxesSeed,
  retiredAlertInboxIds,
  promotionalBanners,
  companies,
  companySignatureLinkMap,
  companyAliases,
  teamSignature,
  teamSignatureInboxes,
  teamIdToCompany,
  greetingPools,
  senderFromEmailToInbox,
  supportInboundLocalParts
};
})();
