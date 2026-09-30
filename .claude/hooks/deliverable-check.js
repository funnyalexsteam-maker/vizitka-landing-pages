#!/usr/bin/env node
// PostToolUse hook: проверяет HTML-деливерабл сразу после записи.
//
// Зачем: чек-лист в docs/ забывается, а дефекты тиражируются, потому что
// каждый клиентский файл клонируется из предыдущего. Аудит 30.09.2026 показал,
// что ни на одном лендинге нет og-тегов, а в template.html нет ни
// prefers-reduced-motion, ни alt, ни meta description.
//
// Проверяются только страницы в корне репозитория: там лежат деливераблы.
// docs/, .worktrees/, node_modules/ и assets/ пропускаются.

const { readFileSync } = require("node:fs");
const { basename, dirname, resolve, sep } = require("node:path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const filePath = payload?.tool_input?.file_path || "";
  if (!filePath.toLowerCase().endsWith(".html")) process.exit(0);

  const projectRoot = resolve(__dirname, "..", "..");
  const fileDir = resolve(dirname(filePath));
  // Только корень репозитория: вложенные папки это исходники, а не то, что уходит клиенту.
  if (fileDir !== projectRoot) process.exit(0);
  if (filePath.split(sep).some((p) => p === "node_modules" || p === ".worktrees")) {
    process.exit(0);
  }

  let html;
  try {
    html = readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }

  const name = basename(filePath);
  const problems = [];
  const has = (re) => re.test(html);

  // 1. Незаменённые плейсхолдеры. Самая дорогая ошибка: уходит клиенту как есть.
  const placeholders = [...new Set(html.match(/\{\{[A-ZА-Я0-9_]+\}\}/g) || [])];
  if (placeholders.length && !/^template\.html$/i.test(name)) {
    problems.push(`остались плейсхолдеры: ${placeholders.slice(0, 6).join(", ")}`);
  }

  // 2. Ссылку пересылают в мессенджере, без og она приходит голой строкой.
  if (!has(/property=["']og:title["']/i)) problems.push("нет og:title");
  if (!has(/property=["']og:description["']/i)) problems.push("нет og:description");
  if (!has(/property=["']og:image["']/i)) problems.push("нет og:image (превью в WhatsApp и Telegram)");

  // 3. Базовая гигиена страницы.
  if (!has(/name=["']viewport["']/i)) problems.push("нет meta viewport");
  if (!has(/name=["']description["']/i)) problems.push("нет meta description");
  if (!has(/<html[^>]+lang=/i)) problems.push("нет lang у <html>");
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!title || !title[1].trim()) problems.push("пустой или отсутствующий <title>");

  // 4. Доступность: alt обязателен, анимации должны уметь выключаться.
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter((tag) => !/\balt=/i.test(tag));
  if (noAlt.length) problems.push(`${noAlt.length} <img> без alt`);
  if (has(/@keyframes|transition:|animation:/i) && !has(/prefers-reduced-motion/i)) {
    problems.push("есть анимации, но нет prefers-reduced-motion");
  }

  // 5. Адаптив. Один медиазапрос это обычно забытый мобильный.
  const mediaQueries = (html.match(/@media/g) || []).length;
  if (mediaQueries < 2) problems.push(`медиазапросов: ${mediaQueries}, проверь вид на 390px`);

  if (!problems.length) process.exit(0);

  console.error(
    `Чек-лист деливерабла, ${name}:\n` +
      problems.map((p) => `  - ${p}`).join("\n") +
      `\n\nПочини это до сдачи. Полный чек-лист: CHECKLIST-landing.md` +
      `\nЕсли правка промежуточная и страница ещё не готова, скажи об этом и продолжай.`
  );
  process.exit(2);
});
