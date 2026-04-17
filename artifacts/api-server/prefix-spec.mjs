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

const POOLS = {
  firstName: ["Marcus", "Jordan", "Tyler", "Daniela", "Chris", "Lisa", "Samira", "Aaron", "Maya", "Devon", "Kai", "Riley", "Quinn", "Avery"],
  lastName: ["Rivera", "Bennett", "Chen", "Davis", "Patel", "Nguyen", "Brooks", "Silva", "Walker", "Hayes", "Reed", "Foster", "Carter"],
  nickname: ["Speedster", "Cannon", "Showtime", "Iceberg", "Lightning", "Hammer", "Phantom", "Wizard"],
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

function injectExamples(node, parentKey = null) {
  if (Array.isArray(node)) {
    node.forEach((n) => injectExamples(n, parentKey));
    return;
  }
  if (!node || typeof node !== "object") return;

  if (node.type === "string" && !("example" in node) && !("enum" in node) && !("const" in node) && parentKey && !SKIP_KEYS.has(parentKey)) {
    const pool = POOLS[parentKey];
    if (pool) {
      node.example = pick(pool);
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [k, v] of Object.entries(node.properties)) {
      injectExamples(v, k);
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties") continue;
    if (v && typeof v === "object") injectExamples(v, k);
  }
}

if (doc && doc.components && doc.components.schemas) {
  injectExamples(doc.components.schemas);
}
if (doc && doc.paths) injectExamples(doc.paths);

writeFileSync(outputPath, YAML.stringify(doc, { lineWidth: 0 }));
console.log(`Wrote prefixed spec with English examples to ${outputPath}`);
