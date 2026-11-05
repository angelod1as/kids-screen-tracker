// #131: declared (app) vs real (Family Link) usage, per kid. Read-only by
// design: plain Node so it runs inside the published image via stdin
// (docs/usage-audit.md). Never opens the database for writing.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolved from the working directory: under `node -` there is no script path.
const Database = createRequire(join(process.cwd(), "/"))("better-sqlite3");

const MINUTES_PER_HOUR = 60;
const FREE_WHATSAPP_MINUTES_PER_DAY = 60;
const APPS = [
  { key: "whatsapp", label: "WhatsApp", destinations: ["zap", "whatsapp"] },
  {
    key: "instagram",
    label: "Instagram",
    destinations: ["insta", "instagram"],
  },
  // Not requestable in the app, so every Chrome minute is undeclared.
  { key: "chrome", label: "Chrome", destinations: [] },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) continue;
    args[flag.slice(2)] = argv[i + 1];
    i++;
  }
  return args;
}

// D13: the day is São Paulo's, never UTC's.
function saoPauloToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

function addDays(day, delta) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

function formatMinutes(total) {
  const minutes = Math.round(Math.abs(total));
  const sign = total < 0 && minutes > 0 ? "−" : "";
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${sign}${rest} min`;
  return `${sign}${hours}h${rest === 0 ? "" : String(rest).padStart(2, "0")}`;
}

const formatHours = (hours) => formatMinutes(hours * MINUTES_PER_HOUR);

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const databasePath = process.env.DATABASE_PATH;
if (!databasePath) fail("DATABASE_PATH is not set.");

const today = saoPauloToday();
const since = args.since ?? addDays(today, -6);
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) fail("--since must be YYYY-MM-DD.");
const days = daysBetween(since, today);

const db = new Database(databasePath, { readonly: true, fileMustExist: true });

// An earn voided on its activity log keeps `ledger.voided_at` null (D52).
// Group by position: a bare `destination` is the raw column, so `ZAP` and `Zap`
// would land in separate groups.
const LIVE_LEDGER = `
  from ledger l
  left join activity_logs a on a.id = l.activity_log_id
  where l.user_id = ? and l.voided_at is null and a.voided_at is null`;

function auditKid(kid) {
  const rows = db
    .prepare(
      `select l.occurred_on as day, l.kind,
         lower(trim(coalesce(l.destination, ''))) as destination,
         sum(l.hours) as hours
       ${LIVE_LEDGER} and l.occurred_on >= ? and l.occurred_on <= ?
       group by day, l.kind, 3
       order by day, l.kind, destination`,
    )
    .all(kid.id, since, today);
  const { balance } = db
    .prepare(
      `select coalesce(sum(case when l.kind = 'spend' then -l.hours else l.hours end), 0)
         as balance ${LIVE_LEDGER}`,
    )
    .get(kid.id);

  const declared = new Map();
  const lines = [`${kid.display_name} — ${since} a ${today}`, ""];
  lines.push("dia         ganho     declarado");
  for (const day of days) {
    const ofDay = rows.filter((row) => row.day === day);
    const earned = ofDay
      .filter((row) => row.kind === "earn")
      .reduce((sum, row) => sum + row.hours, 0);
    const spends = ofDay.filter((row) => row.kind === "spend");
    const spendText = spends
      .map(
        (row) =>
          `${row.destination || "(sem destino)"} ${formatHours(row.hours)}`,
      )
      .join(", ");
    lines.push(`${day}  ${formatHours(earned).padEnd(8)}  ${spendText || "—"}`);
    for (const row of spends) {
      declared.set(
        row.destination,
        (declared.get(row.destination) ?? 0) + row.hours,
      );
    }
  }

  const earnedTotal = rows
    .filter((row) => row.kind === "earn")
    .reduce((sum, row) => sum + row.hours, 0);
  lines.push("", "declarado por destino:");
  for (const [destination, hours] of [...declared].sort()) {
    lines.push(
      `  ${(destination || "(sem destino)").padEnd(14)} ${formatHours(hours)}`,
    );
  }
  lines.push(
    "",
    `ganho na janela: ${formatHours(earnedTotal)}`,
    `saldo atual:     ${formatHours(balance)}`,
  );
  console.log(lines.join("\n"));
}

function renderCard(kid, familyLink) {
  const usageDays = Object.keys(familyLink.days ?? {}).sort();
  if (usageDays.length === 0) fail("Family Link JSON has no days.");
  const from = usageDays[0];
  const to = usageDays[usageDays.length - 1];
  // The card's window is the Family Link days, not `--since`.
  const declared = new Map(
    db
      .prepare(
        `select lower(trim(coalesce(l.destination, ''))) as destination,
           sum(l.hours) as hours
         ${LIVE_LEDGER} and l.kind = 'spend'
           and l.occurred_on in (select value from json_each(?))
         group by 1`,
      )
      .all(kid.id, JSON.stringify(usageDays))
      .map((row) => [row.destination, row.hours]),
  );

  const apps = APPS.map((app) => {
    const declaredMinutes =
      app.destinations.reduce(
        (sum, destination) => sum + (declared.get(destination) ?? 0),
        0,
      ) * MINUTES_PER_HOUR;
    const free =
      app.key === "whatsapp"
        ? FREE_WHATSAPP_MINUTES_PER_DAY * usageDays.length
        : 0;
    const allowed = free + declaredMinutes;
    const used = usageDays.reduce(
      (sum, day) => sum + (Number(familyLink.days[day][app.key]) || 0),
      0,
    );
    return { ...app, allowed, used, over: Math.max(0, used - allowed) };
  });

  const totalOver = apps.reduce((sum, app) => sum + app.over, 0);
  const appHtml = apps
    .map((app) => {
      const scale = Math.max(app.allowed, app.used, 1);
      const width = (minutes) => `${((minutes / scale) * 100).toFixed(1)}%`;
      const status =
        app.over > 0
          ? `<span class="badge over">+${formatMinutes(app.over)}</span>`
          : `<span class="badge ok">em dia</span>`;
      const undeclared =
        app.allowed === 0 && app.used > 0
          ? `<p class="note">não declarou</p>`
          : "";
      return `<section class="app">
  <header><h2>${app.label}</h2>${status}</header>
  <div class="row"><span>permitido</span><div class="track"><div class="bar allowed" style="width:${width(app.allowed)}"></div></div><b>${formatMinutes(app.allowed)}</b></div>
  <div class="row"><span>usou</span><div class="track"><div class="bar used ${app.over > 0 ? "over" : "ok"}" style="width:${width(app.used)}"></div></div><b>${formatMinutes(app.used)}</b></div>
  ${undeclared}
</section>`;
    })
    .join("\n");

  const overApps = apps.filter((app) => app.over > 0).map((app) => app.label);
  const conclusion =
    overApps.length === 0
      ? "Ficou dentro do combinado."
      : `Passou do combinado em ${overApps.join(", ")}.`;

  const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "usage-card.template.html"),
    "utf8",
  );
  const values = {
    KID: escapeHtml(kid.display_name),
    WINDOW: `${from} a ${to} · ${usageDays.length} dias`,
    DEVICE: escapeHtml(familyLink.device ?? "celular"),
    HERO: totalOver > 0 ? `+${formatMinutes(totalOver)}` : "0",
    HERO_CLASS: totalOver > 0 ? "over" : "ok",
    APPS: appHtml,
    CONCLUSION: escapeHtml(conclusion),
  };
  return template.replace(
    /__([A-Z_]+)__/g,
    (match, key) => values[key] ?? match,
  );
}

try {
  const kids = db
    .prepare(
      `select id, display_name from users
       where role = 'kid' and active = 1
         and (? is null or lower(display_name) = lower(?))
       order by id`,
    )
    .all(args.kid ?? null, args.kid ?? null);
  if (kids.length === 0) fail(`No active kid matches ${args.kid ?? "(any)"}.`);

  if (args.familylink && kids.length !== 1) {
    fail("--familylink needs --kid: the card is for one kid.");
  }

  for (const [index, kid] of kids.entries()) {
    if (index > 0) console.log("");
    auditKid(kid);
    if (args.familylink) {
      const familyLink = JSON.parse(readFileSync(args.familylink, "utf8"));
      const html = renderCard(kid, familyLink);
      const out = args.out ?? "usage-card.html";
      writeFileSync(out, html);
      console.log(`\ncard: ${out}`);
    }
  }
} finally {
  db.close();
}
