import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(here, "../../lib/api-spec/openapi.yaml");
const outputPath = resolve(here, ".openapi-prefixed.yaml");

const PREFIX = "/api/v1";
const text = readFileSync(inputPath, "utf8");
const doc = YAML.parse(text);

if (doc && typeof doc === "object" && doc.paths && typeof doc.paths === "object") {
  const newPaths = {};
  for (const [p, v] of Object.entries(doc.paths)) {
    newPaths[p.startsWith(PREFIX) ? p : PREFIX + p] = v;
  }
  doc.paths = newPaths;
}

const HUMAN_PHOTOS = [
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1607746882042-944635dfe10e?w=400&h=400&fit=crop&crop=faces",
  "https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=400&h=400&fit=crop&crop=faces",
];

const TEAM_PHOTOS = [
  "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1607627000458-210e8d2bdb1d?w=600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=600&h=600&fit=crop",
];

const ORG_LOGOS = [
  "https://images.unsplash.com/photo-1565992441121-4367c2967103?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=400&h=400&fit=crop",
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=400&h=400&fit=crop",
];

const FIELD_PHOTOS = [
  "https://images.unsplash.com/photo-1486286701208-1d58e9338013?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1552667466-07770ae110d0?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1518604666860-9ed391f76460?w=1600&h=600&fit=crop",
  "https://images.unsplash.com/photo-1577223625816-7546f13df25d?w=1600&h=600&fit=crop",
];

const ACTION_PHOTOS = [
  "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1556009896-d3e35c4d2dc1?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1543351611-58f69d7c1781?w=1200&h=800&fit=crop",
];

const POOLS = {
  firstName: ["Marcus", "Jordan", "Tyler", "Daniela", "Chris", "Lisa", "Samira", "Aaron", "Maya", "Devon", "Kai", "Riley", "Quinn", "Avery"],
  lastName: ["Rivera", "Bennett", "Chen", "Davis", "Patel", "Nguyen", "Brooks", "Silva", "Walker", "Hayes", "Reed", "Foster", "Carter"],
  bio: [
    "Speed, hands, and vision. Dedicated to outworking the competition.",
    "Three-sport athlete with a love for the game and the grind.",
    "Coach by day, fan by night. Building champions on and off the field.",
    "Class of 2026. Future is bright. Stay locked in.",
  ],
  displayName: ["Marcus Rivera", "Jordan Bennett", "Tyler Chen", "Coach Davis", "Daniela Patel", "Chris Nguyen", "Maya Brooks"],
  name: [
    "Westfield Warriors",
    "Riverside Soccer Club",
    "Eastside Eagles",
    "North Valley Athletic Association",
    "Lincoln High Football",
    "Cardinal Track & Field",
  ],
  title: [
    "Saturday's win secures playoff spot",
    "Senior night recap: a perfect ending",
    "Player profile: rising star at WR",
    "Spring tryouts open next week",
    "Coach's notes from the championship",
  ],
  description: [
    "Youth athletic organization developing the next generation of athletes.",
    "Competitive travel team focused on player development and teamwork.",
    "Building character, work ethic, and a love for the sport.",
  ],
  body: [
    "Great game tonight, team! Proud of how everyone showed up.",
    "Practice was a grind today. The work is paying off.",
    "Big shoutout to the seniors for leading by example.",
    "Highlight reel from Friday's matchup is up — go check it out.",
    "Thanks to all the families who came out to support us.",
  ],
  bodyPreview: [
    "Great game tonight, team! Proud…",
    "Practice was a grind today. The work…",
    "Highlight reel from Friday's…",
    "Thanks to all the families who…",
  ],
  content: [
    "We came into Saturday's matchup knowing it would be a battle, and the team responded with one of the most complete performances of the season.",
    "Senior night is always emotional, but seeing this group of athletes finish their journey on top made it unforgettable.",
  ],
  caption: [
    "Game-winning catch in the 4th quarter.",
    "Senior night highlights from the entire squad.",
    "Coach's pre-game speech you have to hear.",
  ],
  message: [
    "Want to grab some film review tomorrow?",
    "Practice moved to 4pm — pass it along to the team.",
    "Awesome game today. Proud of the effort.",
    "Hey, you free this weekend for an extra session?",
  ],
  bodyPreview: ["Want to grab some film review…", "Practice moved to 4pm — pass…", "Awesome game today. Proud of the effort."],
  sport: ["Football", "Basketball", "Soccer", "Baseball", "Track & Field", "Volleyball", "Lacrosse"],
  position: ["Wide Receiver", "Quarterback", "Point Guard", "Midfielder", "Pitcher", "Sprinter", "Outside Hitter"],
  level: ["Varsity", "JV", "Freshman", "U16", "U18", "Travel"],
  location: ["Westfield, NJ", "Riverside, CA", "Lincoln, NE", "Cedar Falls, IA", "Bay Shore, NY"],
  city: ["Westfield", "Riverside", "Lincoln", "Cedar Falls", "Bay Shore"],
  state: ["NJ", "CA", "NE", "IA", "NY", "TX", "FL"],
  grade: ["Class of 2025", "Class of 2026", "Class of 2027", "Senior", "Junior"],
  senderDisplayName: ["Marcus Rivera", "Jordan Bennett", "Coach Davis", "Maya Brooks"],
  participantName: ["Marcus Rivera", "Jordan Bennett", "Coach Davis", "Westfield Warriors"],
  fileName: ["highlight-reel.mp4", "team-photo.jpg", "playbook.pdf", "scoring-clip.mov"],
  preview: ["Great game tonight, team!", "Practice was a grind today."],
  reason: ["Spam or off-topic", "Inappropriate language", "Misleading content"],
  email: ["marcus@kinectem.demo", "jordan@kinectem.demo", "coach@kinectem.demo", "maya@kinectem.demo"],
  website: ["https://kinectem.demo", "https://westfield-warriors.example.com"],
  slug: ["westfield-warriors", "riverside-soccer", "lincoln-football"],
  tagline: ["Train hard. Play harder.", "Built different.", "Earn it every day."],
};

let pickIdx = 0;
const pick = (arr) => arr[pickIdx++ % arr.length];

const SKIP_KEYS = new Set(["id", "createdAt", "updatedAt", "type", "status", "role", "direction", "kind", "format", "mimeType"]);

function pickImage(propertyKey, schemaName) {
  const sn = (schemaName || "").toLowerCase();
  if (propertyKey === "coverPhotoUrl") return pick(FIELD_PHOTOS);
  if (propertyKey === "avatarUrl") {
    if (sn.includes("team")) return pick(TEAM_PHOTOS);
    if (sn.includes("organization") || sn.includes("org")) return pick(ORG_LOGOS);
    return pick(HUMAN_PHOTOS);
  }
  if (propertyKey === "url" && sn.includes("asset")) return pick(ACTION_PHOTOS);
  if (propertyKey === "thumbnailUrl" || propertyKey === "previewUrl")
    return pick(ACTION_PHOTOS);
  return null;
}

function injectExamples(node, parentKey = null, schemaName = null) {
  if (Array.isArray(node)) {
    node.forEach((n) => injectExamples(n, parentKey, schemaName));
    return;
  }
  if (!node || typeof node !== "object") return;

  if (
    node.type === "string" &&
    !("example" in node) &&
    !("enum" in node) &&
    !("const" in node) &&
    parentKey &&
    !SKIP_KEYS.has(parentKey)
  ) {
    const img = pickImage(parentKey, schemaName);
    if (img) {
      node.example = img;
    } else {
      const pool = POOLS[parentKey];
      if (pool) node.example = pick(pool);
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [k, v] of Object.entries(node.properties)) {
      injectExamples(v, k, schemaName);
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties") continue;
    if (v && typeof v === "object") injectExamples(v, k, schemaName);
  }
}

if (doc && doc.components && doc.components.schemas) {
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    injectExamples(schema, null, name);
  }
}
if (doc && doc.paths) injectExamples(doc.paths);

writeFileSync(outputPath, YAML.stringify(doc, { lineWidth: 0 }));
console.log(`Wrote prefixed spec with English examples to ${outputPath}`);
