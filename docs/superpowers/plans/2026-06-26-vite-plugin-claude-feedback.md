# vite-plugin-claude-feedback — Implementation Plan (circle-skill)

> **For agentic workers:** этот план исполняется плагином **circle-skill** пофазно (по фазе на свежую фоновую сессию). Преамбула (`## Контекст` / `## Стратегия` / `## Риски`) — общий контекст, executor читает её на старте КАЖДОЙ фазы; в теле фаз не дублируется. Спека-источник: `docs/superpowers/specs/2026-06-26-vite-plugin-claude-feedback-design.md` — читать вместе с планом.

## Контекст

Строим инструмент, который позволяет из живого dev-превью Vue 3 + Vite проекта отправлять Claude Code привязанный к элементу фидбэк. Пользователь жмёт **Alt+C** в превью, опционально выделяет элемент, пишет пожелание/проблему и шлёт. Вместе с текстом уходит: URL страницы, дескриптор элемента, его **Vue-компонент** (имя + `__file:line` + цепочка родителей), и недавняя **консоль браузера**. По запросу Claude может попросить **слепок** Pinia-стора или состояния компонента.

Два кооперирующих артефакта в **одном публичном репо** `https://github.com/SI-IC/vue-pick-problem-skill`:

- **Vite-плагин** `vite-plugin-claude-feedback` (корень репо, npm-пакет, ставится из GitHub без публикации в npm-реестр) — инжектит клиентский оверлей в dev-страницы и поднимает в процессе dev-сервера **bridge** (HTTP + WebSocket).
- **Claude Code-плагин** `claude-feedback` (`claude-plugin/`, ставится через marketplace) — **stdio MCP-сервер** (тонкий HTTP-клиент к bridge), **SessionStart-хук** для авто-вайринга Vite-плагина в проект, skill и слэш-команды.

Ключевые решения (приняты в брейншторминге, не переоткрывать): **pull-доставка** (фидбэк копится в file-backed очереди, Claude забирает MCP-инструментом `get_feedback`); **stdio MCP в CC-плагине** (а не HTTP MCP в Vite-процессе) — Claude владеет жизненным циклом MCP, динамический порт bridge находится через файл `.claude-feedback/bridge.json`; **bridge — единственный владелец** очереди и связи с браузером, MCP-сервер своего состояния не держит; **auto-setup на enable** через SessionStart-хук, **auto-remove не делаем** (ручной `/feedback:remove`); **авто-версионность** через husky (patch-bump + sync обоих манифестов + rebuild `dist/` + tag на каждом изменении плагина); собранный **`dist/` коммитится** (github-install без тулчейна).

Текущее состояние: репо пустое (только `docs/`, git инициализирован, первый коммит — спека). Стек целевых проектов: Vue 3.5 + Vite 7 + Pinia 3 + TypeScript (зеркалит conveyor-фронтенд).

## Стратегия

Доменный граф зависимостей (порядок фаз):

```
Ф1 Инфра (scaffold+build+versioning+marketplace+README)
      │
      ├──> Ф2 Server: bridge + queue ───────────────┐
      │                                              │
      ├──> Ф3 Client collectors: resolve/console/snapshot
      │                                              │
      │        Ф4 Client overlay + Vite plugin entry ◄── deps [Ф2, Ф3]
      │                                              │
      └──> Ф5 MCP server (stdio → bridge) ◄── deps [Ф2]
                    │
                Ф6 CC-плагин: manifest+hook+wire/unwire+skill+commands ◄── deps [Ф5]
                    │
                Ф7 demo-app + e2e ◄── deps [Ф4, Ф5, Ф6]
```

Общие контракты между фазами (фиксируются в Ф1/Ф2, потребляются дальше):

- **`.claude-feedback/bridge.json`**: `{ port:number, pid:number, startedAt:number, version:string }`. Пишет bridge (Ф2/Ф4), читает MCP-сервер (Ф5), читает wire.mjs (Ф6) — только чтобы знать, что dev-сервер жив.
- **Bridge HTTP API** (всё на одном http-сервере dev-сервера; браузерные пути проксируются nginx, MCP-пути дёргаются по localhost):
  - браузер: `POST /__claude_feedback/message`, WS `GET /__claude_feedback/ws`
  - MCP (localhost): `GET /__claude_feedback/api/feedback?ack=1`, `POST /__claude_feedback/api/request`, `GET /__claude_feedback/api/status`
- **WS-протокол** (`/__claude_feedback/ws`): браузер→bridge `{type:'hello',tabId,url}` и `{type:'reply',requestId,data?,error?}`; bridge→браузер `{type:'request',requestId,kind:'store'|'component'|'console',args}`.
- **FeedbackPayload** (контракт из спеки, секция «Context Payload»): bridge присваивает `id`,`ts`,`tabId`; остальное шлёт клиент.
- **Build-выход**: `dist/index.js` (Vite-плагин, ESM) + `dist/index.d.ts` + `dist/client.js` (клиентский бандл, IIFE, инлайнится в HTML). `package.json` `exports`/`main`/`types` → на `dist/`.

TDD-дисциплина: Ф2, Ф3, Ф5 — чистая логика (parser/transform/server/state) → тесты-первыми. Ф4, Ф6, Ф7 — UI/glue/config/e2e → тесты обязательны к моменту verify, но iron-law-порядок не применять. Каждая фаза коммитит часто; на каждое изменение plugin-кода husky сам бампит версию (Ф1 ставит инфру).

## Риски

- **Резолв Vue-компонента опирается на внутренности Vue 3** (`el.__vueParentComponent`, `type.__file`). Риск: ломкость между минорами Vue / отсутствие `__file` в некоторых сборках. Смягчение: Ф3 — feature-detect + graceful null, тест на «элемент вне приложения», e2e на реальном demo-app (Ф7).
- **WS через nginx-прокси превью** может не проходить upgrade. Смягчение: Vite HMR уже использует WS через тот же прокси (значит проходит); Ф4 — fallback на reconnect, Ф7 e2e гоняет реальный прокси-путь localhost.
- **Авто-`pnpm add github:` в SessionStart-хуке** трогает чужой проект (vite.config, package.json) автоматически. Смягчение: Ф6 — строгая идемпотентность, быстрый no-op если уже вайрено, явный лог, abort если не vue+vite.
- **Коммит `dist/` + авто-bump версии** может зациклить husky (commit→bump→commit). Смягчение: Ф1 — guard «версия уже бампнута в этом staged-наборе» + хук не коммитит сам, только стейджит; tag в post-commit.
- **github-install резолвит latest-tag** на момент вайринга — если тегов ещё нет, install падёт. Смягчение: Ф1 создаёт стартовый тег `v0.0.1`; wire.mjs (Ф6) — внятная ошибка если тегов нет.
- **Сериализация стора/компонента** может упереться в циклы/огромные/несериализуемые значения. Смягчение: Ф3 — safeStringify с cap по глубине/длине и cycle-guard, тесты на циклы и DOM-ноды.

---

## Фаза 1 — Инфра: scaffold, build, авто-версионность, marketplace, README

<!-- circle: status=done order=10 deps=[] autonomy=auto obstacle="" -->

**Цель фазы:** рабочий каркас репо — npm-пакет с собираемым `dist/`, авто-версионность через husky, marketplace-манифест, README. Всё последующее строится на этом.

**Подход (выбран):** сборка через **`tsup`** (бандлит TS в `dist/`, два entry — плагин и клиентский IIFE-бандл, генерит `.d.ts`). Отвергнуто: голый `tsc` (не бандлит клиент в один файл, не делает IIFE), rollup-конфиг вручную (больше boilerplate ради того же). Версионность — **husky pre-commit (bump+sync+rebuild+stage) + post-commit (tag)**; отвергнуто: `changesets`/`semantic-release` (тяжёлый CI-флоу, нужен реестр; нам нужен только git-tag) и conventional-commits-парсинг (избыточно — default patch достаточно).

**Перед добавлением зависимостей** (правило свежих версий): `npm view tsup version`, `npm view husky version`, `npm view typescript version`, `npm view vitest version`, `npm view @modelcontextprotocol/sdk version`, `npm view ws version`. Пинить актуальный latest. Известно на 2026-06-26: `@modelcontextprotocol/sdk@1.29.0`, `ws@8.21.0`, vite latest 8.1.0 (peer ставим `>=5`).

**Шаги:**

1. `package.json` корня: `name:"vite-plugin-claude-feedback"`, `version:"0.0.1"`, `type:"module"`, `exports:{".":{"types":"./dist/index.d.ts","import":"./dist/index.js"}}`, `main:"./dist/index.js"`, `types:"./dist/index.d.ts"`, `files:["dist","src","claude-plugin"]`, `peerDependencies:{"vite":">=5"}`, `devDependencies` (tsup, typescript, vitest, ws, @types/ws, husky, @vitejs/plugin-vue для тестов), `scripts`: `build`,`test`,`test:run`,`prepare:"husky"`,`release`,`check:versions`. Пакетменеджер репо — `pnpm`.
2. `tsconfig.json`: strict, `moduleResolution:"bundler"`, `target:"ES2022"`, `lib:["ES2022","DOM","DOM.Iterable"]`, `types:["node"]`.
3. `tsup.config.ts`: два билда — (a) entry `src/plugin/index.ts` → format esm, dts true, platform node; (b) entry `src/client/index.ts` → `dist/client.js`, format iife, platform browser, без dts. На этом этапе создать заглушки `src/plugin/index.ts` (`export default function claudeFeedback(){ return { name:'vite-plugin-claude-feedback' } }`) и `src/client/index.ts` (`/* overlay placeholder */`) — чтобы build проходил.
4. Husky: `scripts/version-sync.mjs` (функция-ядро: читает `version` из корневого `package.json`, пишет в `claude-plugin/.claude-plugin/plugin.json.version` и в `.claude-plugin/marketplace.json` → `plugins[name==="claude-feedback"]` если там появится поле `version`), `scripts/check-versions.mjs` (exit 1 если три версии расходятся), `scripts/release.mjs` (arg `patch|minor|major`, поднимает версию в корневом package.json через semver, зовёт version-sync). Хуки: `.husky/pre-commit` — если в staged есть `src/` или `claude-plugin/` И версия ещё не бампнута в этом коммите (guard: сравнить версию HEAD с рабочей; равны → bump patch), затем `node scripts/release.mjs patch` (только sync без повторного bump, если уже) → `pnpm build` → `git add dist package.json claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json`. `.husky/post-commit` — `git tag "v$(node -p "require('./package.json').version")"` (idempotent: не падать если тег есть).
5. `.claude-plugin/marketplace.json` — как в спеке (секция «Marketplace manifest»): `name:"vue-pick-problem-skill"`, `owner:{name:"SI-IC"}`, plugins[0] = `{name:"claude-feedback", source:"./claude-plugin", description:"...", version:"0.0.1"}`.
6. `claude-plugin/.claude-plugin/plugin.json` — минимальный валидный: `{name:"claude-feedback", version:"0.0.1", description:"..."}` (mcpServers/hooks/skills допишет Ф5/Ф6).
7. `README.md` — секция установки (marketplace add/install + conveyor library), что происходит авто (SessionStart wire), ручные `/feedback:setup` `/feedback:remove`, краткий usage (Alt+C). Допустимо оставить usage-детали ссылкой на спеку; install-инструкции — полные.
8. `.gitignore`: `node_modules/`, `.claude-feedback/`, `*.log` (НЕ игнорировать `dist/`).
9. Стартовый тег: после первого коммита фазы убедиться что существует `v0.0.1` (post-commit хук создаст; если нет — `git tag v0.0.1`).

**Edge-cases:**

- empty: `check-versions.mjs` при отсутствии поля `version` в каком-то манифесте → трактовать как расхождение, exit 1 с указанием файла.
- boundary: повторный коммит без изменений plugin-кода → pre-commit НЕ бампит (guard по staged-путям), не зацикливается.
- concurrency: post-commit tag уже существует → `git tag` падает; обернуть `|| true` с проверкой что тег указывает на нужный commit.
- malformed-input: `release.mjs` с неизвестным arg → exit 1 с usage.
- deleted-resource: отсутствует `claude-plugin/.claude-plugin/plugin.json` при sync → внятная ошибка, exit 1.
- external-failure: `pnpm build` в хуке упал → коммит отменяется (хук возвращает ненулевой код), dist не рассинхронизируется.

**Verify-гейт (исполняемый смоук, не type-check):**

1. `pnpm install && pnpm build` → `dist/index.js`, `dist/index.d.ts`, `dist/client.js` существуют.
2. `node -e "import('./dist/index.js').then(m=>{ const p=m.default(); if(p.name!=='vite-plugin-claude-feedback') process.exit(1); console.log('plugin ok') })"` → печатает `plugin ok`.
3. `node scripts/check-versions.mjs` → exit 0, три версии совпадают (`0.0.1`).
4. Тест версионности: `node scripts/release.mjs patch` → версия стала `0.0.2` во всех трёх манифестах; `node scripts/check-versions.mjs` → exit 0. Откатить (`git checkout .`) чтобы остаться на `0.0.1`.
5. `git ls-remote --tags . || git tag` показывает `v0.0.1` локально.

**Контракт для следующих фаз:** build-команда `pnpm build`, выход `dist/{index.js,index.d.ts,client.js}`; `package.json exports`; авто-версионность активна (фазы просто коммитят, версия бампается сама). `следующий шаг: Ф2 и Ф3 могут стартовать параллельно после Ф1 (обе deps=[1]).`

---

## Фаза 2 — Server: bridge + queue

<!-- circle: status=done order=20 deps=[1] autonomy=auto obstacle="" -->

**Цель фазы:** `src/server/bridge.ts` + `src/server/queue.ts` — HTTP+WS сервер с file-backed очередью и pending-снапшот-запросами с таймаутом. Чистая backend-логика → TDD.

**Подход (выбран):** один `http.Server` + `ws.WebSocketServer` в `noServer`-режиме, апгрейд по пути `/__claude_feedback/ws`; bridge экспортирует `createBridge(opts)` (для монтирования в Vite через `httpMiddleware`/`handleUpgrade`, Ф4) и `createStandaloneBridge(opts)` (для тестов/смоука — поднимает свой http-сервер поверх `createBridge`). Отвергнуто: отдельный порт только под WS (лишний листенер, хуже проходит через прокси) и Vite `server.ws` (это HMR-канал, переиспользование хрупко). Очередь — **append-only JSONL** в `.claude-feedback/queue.jsonl` + ин-мемори зеркало; ack помечает `acked:true` дозаписью tombstone-строки (компакт при чтении). Отвергнуто: переписывание всего файла на каждый ack (гонки, потеря при краше).

**Файлы:** Create `src/server/queue.ts`, `src/server/bridge.ts`, `src/server/types.ts`; Test `tests/unit/queue.test.ts`, `tests/unit/bridge.test.ts`.

**Интерфейсы (Produces — потребляют Ф4/Ф5):**

- `types.ts`: `FeedbackPayload` (поля из спеки), `ConsoleEntry{level,ts,text}`, `SnapshotRequest{requestId,kind:'store'|'component'|'console',args:any}`, `BridgeInfo{port,pid,startedAt,version}`.
- `queue.ts`: `createQueue(dir:string)` → `{ append(p:Omit<FeedbackPayload,'id'|'ts'>&{tabId:string}):FeedbackPayload; readPending(ack:boolean):FeedbackPayload[]; size():number }`. `append` присваивает `id` (`fb_`+монотонный счётчик+random-суффикс без `Date.now` запрета — использовать `process.hrtime.bigint()` и `crypto.randomUUID()`), `ts` (`Date.now()` — в рантайме разрешён, запрет только в workflow-скриптах; в обычном Node-коде ок).
- `bridge.ts`: `createBridge(opts:{queueDir:string, version:string, requestTimeoutMs?:number})` → объект `{ handleUpgrade(req,socket,head), httpMiddleware(req,res,next), writeBridgeInfo(port), requestSnapshot(kind,args):Promise<any>, status():BridgeInfo&{browserConnected:boolean,tabs:string[],queueSize:number}, close() }`. `requestSnapshot` шлёт WS-`request` первому подключённому табу, ждёт `reply` по `requestId` с таймаутом (default 10000мс) → resolve data / reject `{code:'timeout'|'browser_not_connected'}`.
- `bridge.ts` (test/smoke helper): `createStandaloneBridge(opts)` → `{ bridge, server:http.Server, port:number, close() }` — поднимает свой `http.createServer`, навешивает `bridge.httpMiddleware` и `bridge.handleUpgrade`, слушает свободный порт.

**Шаги (TDD):**

1. Тест `queue.test.ts`: append→readPending(false) возвращает элемент с присвоенными id/ts; readPending(true) ack-ает и повторный readPending пуст; пересоздание `createQueue` на том же dir видит неack-нутые (file-backed); битая строка в jsonl пропускается без краша. Запустить — fail.
2. Реализовать `queue.ts` минимально до зелёного. Cap размера тела не здесь (в bridge).
3. Тест `bridge.test.ts` (использовать `createStandaloneBridge` поверх `http.createServer`): (a) `POST /__claude_feedback/message` с payload → 200 `{id}`, очередь size=1; (b) `GET /__claude_feedback/api/feedback?ack=1` → `{items:[...]}` затем пусто; (c) `requestSnapshot('store',{})` без подключённого браузера → reject `browser_not_connected`; (d) с фейковым WS-клиентом (`ws` в тесте), который на `request` шлёт `reply` → resolve данными; (e) WS-клиент молчит → reject `timeout` (тест с `requestTimeoutMs:50`); (f) тело `POST /message` > cap (напр. 5MB) → 413. Запустить — fail.
4. Реализовать `bridge.ts` до зелёного: middleware-роутер по путям, WS upgrade + tab-реестр (`Map<tabId,ws>`), pending `Map<requestId,{resolve,reject,timer}>`, body-size cap, `writeBridgeInfo` пишет `.claude-feedback/bridge.json` атомарно (tmp+rename).
5. Прогнать весь модуль: `pnpm test:run tests/unit`.
6. Commit (husky сам бампнет версию + rebuild dist).

**Edge-cases (с поведением):**

- empty: `readPending` на пустой/несуществующей очереди → `[]` (degrade).
- boundary: payload ровно на границе cap → пройти; +1 байт → 413 (reject).
- concurrency: два `requestSnapshot` одновременно → разные `requestId`, reply матчатся независимо; ответ с неизвестным `requestId` → игнор (не падать).
- external-failure: WS-клиент отвалился во время ожидания (`close`) → pending по этому табу reject `browser_not_connected`, таймер очищен.
- malformed-input: невалидный JSON в `POST /message` → 400; WS-сообщение без `type` → игнор.
- deleted-resource: `queue.jsonl` удалён между append и read → readPending не падает, отдаёт ин-мемори зеркало.
- permission: запись `bridge.json` в read-only dir → лог-ошибка, bridge продолжает (snapshot-запросы работают, только discovery деградирует) — не крашить dev-сервер.

**Verify-гейт (исполняемый смоук):** скрипт `tests/smoke/bridge-smoke.mjs` (закоммитить): поднять `createStandaloneBridge`, `writeBridgeInfo`, реально `curl`-нуть (через `node:http`) `POST /message` + `GET /api/feedback?ack=1`, подключить реальный `ws`-клиент, прогнать один `requestSnapshot('console',{})` round-trip → напечатать `bridge-smoke ok`. Запуск: `node tests/smoke/bridge-smoke.mjs`. Плюс `pnpm test:run tests/unit` зелёный.

**Контракт для следующих фаз:** HTTP/WS API и сигнатуры выше зафиксированы. `следующий шаг: Ф4 монтирует bridge в Vite через httpMiddleware/handleUpgrade в configureServer; Ф5 (MCP) дёргает /__claude_feedback/api/* по localhost-порту из bridge.json.`

---

## Фаза 3 — Client collectors: resolve-component, console-tap, snapshot

<!-- circle: status=done order=30 deps=[1] autonomy=auto obstacle="" -->

**Цель фазы:** три чистых клиентских модуля сбора контекста. TDD на jsdom/happy-dom.

**Подход (выбран):** резолв компонента — подъём по `el.__vueParentComponent` (Vue 3 internal `ComponentInternalInstance`), до первого с `type.__file`; имя из `type.name || type.__name || basename(__file)`. Отвергнуто: парсинг `data-v-` scope-id (не даёт имя/файл) и зависимость от установленного Vue DevTools (не гарантирован). Console-tap — **tee** (оборачиваем, оригинал вызываем), кольцевой буфер фиксированного размера. Snapshot стора — через Pinia на devtools-хуке `window.__VUE_DEVTOOLS_GLOBAL_HOOK__` → `app._instance.appContext.config.globalProperties.$pinia` или `pinia._s` (Map стораов); сериализация — `safeStringify` с cap глубины/длины + cycle-guard + strip функций/DOM. Отвергнуто: `JSON.stringify` напрямую (падает на циклах, тащит DOM).

**Файлы:** Create `src/client/resolve-component.ts`, `src/client/console-tap.ts`, `src/client/snapshot.ts`, `src/client/safe-stringify.ts`; Test `tests/unit/resolve-component.test.ts`, `tests/unit/console-tap.test.ts`, `tests/unit/snapshot.test.ts`. Тестовое окружение — vitest `environment:'happy-dom'` (добавить в `tsup`/vitest конфиг; happy-dom уже знаком по conveyor-фронтенду).

**Интерфейсы (Produces — потребляет Ф4):**

- `resolveComponent(el:Element|null):{ name:string, file:string|null, chain:string[] } | null`
- `installConsoleTap(size?:number):{ getBuffer():ConsoleEntry[]; dispose():void }` (size default 200; вешает обёртки на `console.{log,info,warn,error,debug}` + `window` `error`/`unhandledrejection`)
- `describeElement(el:Element):{ tag:string, classes:string[], text:string, selector:string }` (в этом же `resolve-component.ts` или отдельном `describe-element.ts` — селектор: устойчивый CSS-путь nth-of-type)
- `snapshotStore(args:{store?:string}):{ store:string, state:any } | { stores:string[] } | { error:'not_found', available:string[] }`
- `snapshotComponent(args:{selector?:string, last?:boolean}, lastEl?:Element):{ name:string, props:any, state:any } | { error:'not_found' }`
- `safeStringify(value:any, opts?:{maxDepth?:number,maxLen?:number}):any` (возвращает уже безопасный для JSON объект)

**Шаги (TDD):**

1. `safe-stringify.test.ts`: цикл (`a.self=a`) → не падает, помечает `'[Circular]'`; глубина > maxDepth → `'[MaxDepth]'`; функция → `'[Function]'`; DOM-нода → `'[DOM:tag]'`; длинная строка обрезается. Реализовать до зелёного.
2. `resolve-component.test.ts`: собрать фейковый DOM где у элемента цепочка `__vueParentComponent` с `type.__file`/`type.name` → корректные `name/file/chain`; элемент без Vue-инстанса (вне приложения) → `null`; `describeElement` даёт tag/classes/text/selector, селектор находит тот же элемент через `querySelector`. Реализовать.
3. `console-tap.test.ts`: лог сверх size → буфер кольцом (старые вытесняются); `console.error` и эмулированный `window.dispatchEvent(new ErrorEvent('error',...))`/`unhandledrejection` попадают в буфер; оригинальный `console.log` всё ещё вызывается (spy); `dispose()` снимает обёртки. Реализовать.
4. `snapshot.test.ts`: смоделировать `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`/`pinia._s` Map с фейковым стором → `snapshotStore({store:'x'})` отдаёт state; без `store` → список id; несуществующий id → `{error:'not_found',available}`; стор с циклом в state → не падает (через safeStringify); `snapshotComponent` по селектору достаёт props/state из `__vueParentComponent`. Реализовать.
5. `pnpm test:run tests/unit` зелёный. Commit.

**Edge-cases (с поведением):**

- empty: `resolveComponent(null)` → null; пустой стор → `state:{}`.
- boundary: буфер size=0 → не пишет, не падает; selector для элемента без родителя (`<html>`) → корректный путь.
- concurrency: несколько `installConsoleTap` подряд → каждый ставит свою обёртку поверх; `dispose` снимает только свою (сохранять предыдущую ссылку) — degrade, не дублировать в один буфер.
- external-failure: `__VUE_DEVTOOLS_GLOBAL_HOOK__` отсутствует → `snapshotStore` → `{stores:[]}` / понятный `{error:'no_pinia'}` (не throw).
- malformed-input: `snapshotComponent({selector:'>>>bad'})` → `querySelector` бросает → ловим, `{error:'not_found'}`.
- deleted-resource: selector указывает на удалённый из DOM элемент → `{error:'not_found'}`.
- browser/UX: элемент в Shadow DOM приложения → резолв возвращает null gracefully (документировать ограничение).

**Verify-гейт (исполняемый смоук):** `pnpm test:run tests/unit/resolve-component.test.ts tests/unit/console-tap.test.ts tests/unit/snapshot.test.ts tests/unit/safe-stringify.test.ts` — все зелёные (это и есть исполнение кода на happy-dom). Дополнительно `node -e "/* import dist? нет — это client TS */"` не нужен; модули проверяются тестами.

**Контракт для следующих фаз:** сигнатуры выше — публичный API коллекторов для оверлея. `следующий шаг: Ф4 импортирует resolveComponent/describeElement/installConsoleTap для сборки FeedbackPayload и snapshotStore/snapshotComponent для ответа на WS-request.`

---

## Фаза 4 — Client overlay + Vite plugin entry

<!-- circle: status=done order=40 deps=[2,3] autonomy=auto obstacle="" -->

**Цель фазы:** клиентский оверлей (Alt+C, модалка, element-picker, WS-клиент, сборка payload, ответы на snapshot-request) + Vite-плагин entry, который инжектит клиентский бандл и монтирует bridge в dev-сервер. После этой фазы инструмент работает end-to-end на dev-сервере.

**Подход (выбран):** оверлей рендерится в **Shadow DOM** (изоляция стилей в обе стороны), один корневой `<div id="__claude_feedback_root">` с `attachShadow`. UI — на нативном DOM (без Vue, чтобы не конфликтовать с приложением и не раздувать бандл). Hotkey по умолчанию **Alt+C** (`e.altKey && e.code==='KeyC'`), конфигурируемо. Element-picker — capture-phase listeners на `document`, подсветка через absolutely-positioned оверлей-рамку + тултип с именем компонента; клик выбора `preventDefault+stopPropagation` (не доходит до приложения), Esc отменяет. Vite entry: `transformIndexHtml` инлайнит содержимое `dist/client.js` в `<script>` (с конфигом плагина через `window.__CLAUDE_FEEDBACK_CFG__`), `configureServer(server)` монтирует `bridge.httpMiddleware` на `server.middlewares` и `bridge.handleUpgrade` на `server.httpServer.on('upgrade', ...)`, пишет `bridge.json` с фактическим портом (из `server.httpServer.address()` или `server.config.server.port`). `apply:'serve'`. Отвергнуто: инжект через отдельный `<script src>` на bridge-порт (CORS/прокси-боль — инлайн надёжнее); рендер оверлея во Vue-app (конфликт версий/реактивности).

**Файлы:** Create `src/client/index.ts` (bootstrap: cfg, tap, WS, монтаж оверлея), `src/client/overlay.ts` (UI: модалка+picker), `src/client/ws-client.ts` (reconnect, hello, обработка request→reply); Modify `src/plugin/index.ts` (полная реализация поверх заглушки Ф1); Test `tests/unit/plugin-transform.test.ts`, `tests/unit/ws-client.test.ts`.

**Интерфейсы (Consumes):** из Ф3 — `resolveComponent`,`describeElement`,`installConsoleTap`,`snapshotStore`,`snapshotComponent`; из Ф2 — bridge `createBridge` (+ `createStandaloneBridge` для смоука), `httpMiddleware`/`handleUpgrade`, HTTP пути, WS-протокол, `FeedbackPayload`.

**Шаги:**

1. `plugin-transform.test.ts` (TDD-точка для glue): вызвать default-export плагина, прогнать его `transformIndexHtml` хук на минимальном HTML → результат содержит инлайн-скрипт с маркером `__claude_feedback` и сериализованный cfg; при `apply` в build-режиме хук не инжектит (проверить через `config({command:'build'})` гейтинг). Реализовать гейтинг + инжект в `src/plugin/index.ts`. Клиентский бандл читается из `dist/client.js` (в dev-тесте — замокать чтение файла или собрать перед тестом; default: тест читает реальный `dist/client.js` после `pnpm build`, поэтому тест требует пред-сборки — задокументировать в шаге).
2. `ws-client.test.ts` (happy-dom + фейковый WS): на `request{kind:'console'}` клиент зовёт коллектор и шлёт `reply` с data; на `request{kind:'store',args:{store:'x'}}` → `snapshotStore`; reconnect при close (таймер). Реализовать `ws-client.ts`.
3. Реализовать `overlay.ts`: Shadow DOM, модалка (textarea + кнопки «Выделить элемент»/«Отправить»/«Отмена»), element-picker (hover-highlight + тултип имени компонента из `resolveComponent`, click-select, Esc-cancel), на «Отправить» собрать `FeedbackPayload` (url, describeElement, resolveComponent, getBuffer()) и `POST /__claude_feedback/message`.
4. Реализовать `src/client/index.ts`: прочитать `window.__CLAUDE_FEEDBACK_CFG__`, `installConsoleTap(cfg.consoleBufferSize)`, поднять `ws-client`, повесить Alt+C→открыть оверлей. Хранить «последний выделенный элемент» для `snapshotComponent({last:true})`.
5. Реализовать `configureServer` в `src/plugin/index.ts`: смонтировать bridge middleware + upgrade-handler, `writeBridgeInfo(actualPort)`, `closeBundle`/`buildEnd` → `bridge.close()`.
6. `pnpm build && pnpm test:run`. Commit.

**Edge-cases (с поведением, вкл. browser/UX):**

- empty: «Отправить» с пустым текстом и без элемента → разрешить (degrade) — уходит payload с `message:""`, `element:null`, но с консолью.
- boundary: очень длинный текст/большой буфер → клиент шлёт как есть, bridge кап (Ф2) вернёт 413 → оверлей показывает ошибку «слишком большой контекст», не вешается.
- concurrency: Alt+C при уже открытой модалке → no-op (не плодить вторую); двойной клик «Отправить» → блокировать кнопку до ответа.
- external-failure: bridge недоступен (POST упал) / WS не коннектится → оверлей показывает «dev bridge offline», авто-reconnect WS с backoff.
- malformed-input: приложение перехватывает `keydown` Alt+C себе → слушатель на capture-фазе `window`, чтобы получить первым; picker-клик по самому оверлею → игнор (проверять `composedPath`).
- deleted-resource: snapshot-request на элемент, удалённый из DOM → reply `{error:'not_found'}` (из Ф3).
- browser/UX: переключение вкладки/refresh во время picker → слушатели снимаются на `visibilitychange`/`beforeunload`; back-button — оверлей не персистится между навигациями (SPA-перерисовка — оверлей переинициализируется из `index.ts`); offline — POST падает gracefully.
- prod: `vite build` → ничего не инжектится (тест из шага 1).

**Verify-гейт (исполняемый смоук):** мини-Vite-проект в `tests/smoke/dev-app/` (один `index.html` + `main.ts` + vite.config с плагином) поднять headless-Playwright-скриптом `tests/smoke/overlay-smoke.mjs`: `npx playwright install chromium` (если нужно) → запустить vite dev (на свободном порту) → открыть страницу → проверить HTTP 200 документа, console clean, в DOM есть shadow-root `#__claude_feedback_root` → эмулировать Alt+C → модалка видима → ввести текст, «Отправить» → `GET /__claude_feedback/api/feedback?ack=1` (по localhost-порту) возвращает payload с верным `url` и непустой `console`. Печатает `overlay-smoke ok`. (Это закоммиченный e2e-зачаток; полноценный demo-app — Ф7.)

**Контракт для следующих фаз:** инструмент рабочий на dev-сервере; `bridge.json` пишется реальным портом. `следующий шаг: Ф7 переиспользует этот смоук на полноценном demo-app с Pinia; Ф5/Ф6 не зависят от UI и могли идти параллельно.`

---

## Фаза 5 — MCP server (stdio → bridge)

<!-- circle: status=done order=50 deps=[2] autonomy=auto obstacle="" -->

**Цель фазы:** `claude-plugin/mcp-server.mjs` — stdio MCP-сервер (через `@modelcontextprotocol/sdk`), тонкий HTTP-клиент к bridge; находит bridge через `.claude-feedback/bridge.json`. Без собственного состояния.

**Подход (выбран):** `@modelcontextprotocol/sdk` `McpServer` + `StdioServerTransport`. Каждый инструмент: прочитать `bridge.json` (из `CLAUDE_PROJECT_DIR` или cwd → `.claude-feedback/bridge.json`), дёрнуть соответствующий localhost-эндпоинт bridge через `node:http`. Если файла нет / bridge не отвечает → структурированная ошибка «dev server not running». Отвергнуто: HTTP MCP-транспорт (решено в спеке — stdio робастнее для CC-плагина); кэширование порта в памяти (порт меняется при рестарте dev — читать файл каждый раз).

**Файлы:** Create `claude-plugin/mcp-server.mjs`, `claude-plugin/lib/bridge-client.mjs`; Test `tests/unit/mcp-bridge-client.test.mjs`. (`.mjs` — самостоятельные от сборки Vite-плагина; запускаются node напрямую, поэтому без TS-сборки, чтобы CC-плагин не зависел от `dist/` Vite-пакета.)

**Интерфейсы (Produces — потребляет Ф6 manifest):** исполняемый `node claude-plugin/mcp-server.mjs` (stdio MCP). Инструменты:

- `get_feedback` → `GET /__claude_feedback/api/feedback?ack=1` → `{items}`.
- `request_store_snapshot {store?}` → `POST /api/request {kind:'store',args:{store}}`.
- `request_component_snapshot {selector?,last?}` → `POST /api/request {kind:'component',args}`.
- `request_console {level?}` → `POST /api/request {kind:'console',args:{level}}`.
- `feedback_status` → `GET /api/status`.
  `bridge-client.mjs`: `readBridgeInfo(projectDir)`,`callBridge(method,path,body?)` → `{ok,data}|{error}`.

**Шаги (TDD где можно):**

1. `mcp-bridge-client.test.mjs` (node:test или vitest): поднять фейковый http-сервер, написать `bridge.json` во временную dir → `callBridge('GET','/__claude_feedback/api/status')` возвращает data; отсутствует `bridge.json` → `{error:'bridge_not_running'}`; bridge отвечает 500 → `{error:'bridge_error'}`; connection refused → `{error:'bridge_not_running'}`. Реализовать `bridge-client.mjs`.
2. Реализовать `mcp-server.mjs`: зарегистрировать 5 инструментов, каждый маппит на `callBridge` и оборачивает ошибку bridge в человекочитаемый MCP-ответ (не throw — возвращать `content` с пояснением «попроси пользователя запустить dev-сервер»).
3. Смоук стартом сервера (см. verify). Commit.

**Edge-cases:**

- empty: `get_feedback` при пустой очереди → `{items:[]}` (не ошибка).
- boundary: `bridge.json` есть, но порт уже занят другим процессом → `callBridge` получает не тот ответ/refused → `bridge_not_running`.
- concurrency: два инструмент-вызова подряд → независимые http-запросы, без shared-state.
- external-failure: bridge таймаутит snapshot → bridge вернёт `{error:'timeout'}`, MCP пробрасывает как «браузер не ответил, превью открыто?».
- malformed-input: `bridge.json` битый JSON → `bridge_not_running` (не throw).
- deleted-resource: `bridge.json` удалён между чтением и запросом → `bridge_not_running`.
- permission: нет прав читать `bridge.json` → та же дружелюбная ошибка.

**Verify-гейт (исполняемый смоук):** `tests/smoke/mcp-smoke.mjs` — поднять `createStandaloneBridge` (из Ф2 dist? нет — bridge это TS; для смоука поднять фейковый http-сервер, отвечающий на `/api/status` и `/api/feedback`), написать `bridge.json`, затем запустить `mcp-server.mjs` как дочерний процесс со stdio-transport и отправить MCP `initialize` + `tools/list` + вызвать `feedback_status` → проверить, что вернулся статус. Минимальный вариант (если поднимать MCP-клиента дорого): `node -e` импорт `bridge-client.mjs` и реальный round-trip к фейк-bridge + `node --check claude-plugin/mcp-server.mjs` (синтаксис) + запуск `mcp-server.mjs` с немедленным `tools/list` через `@modelcontextprotocol/sdk` Client поверх `StdioClientTransport`. Default: полный MCP round-trip; fallback на bridge-client round-trip + `--check`, если sdk-client-харнесс не заводится за разумное время. Печатает `mcp-smoke ok`.

**Контракт для следующих фаз:** `claude-plugin/mcp-server.mjs` — рабочий stdio MCP. `следующий шаг: Ф6 регистрирует его в plugin.json mcpServers как command "node ${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs".`

---

## Фаза 6 — CC-плагин: manifest, SessionStart-хук, wire/unwire, skill, commands

<!-- circle: status=pending order=60 deps=[5] autonomy=auto obstacle="" -->

**Цель фазы:** упаковать Claude Code-плагин — `plugin.json` (mcpServers+hooks+skills+commands), SessionStart-хук авто-вайринга, `wire.mjs`/`unwire.mjs`, skill и три команды.

**Подход (выбран):** SessionStart-хук — shell-скрипт `hooks/session-start.sh`, который вызывает `node ${CLAUDE_PLUGIN_ROOT}/scripts/wire.mjs` (идемпотентно). `wire.mjs`: detect vue+vite в `CLAUDE_PROJECT_DIR`; если уже вайрено (grep `vite-plugin-claude-feedback` в vite.config И dep в package.json) → быстрый no-op; иначе `pnpm/npm/yarn add -D github:SI-IC/vue-pick-problem-skill#<latest-tag>` (резолв latest tag через `git ls-remote --tags --refs https://github.com/SI-IC/vue-pick-problem-skill`) + идемпотентный патч vite.config (AST через `@babel/parser`? — нет, держим без тяжёлых deps: регексп-инсерт import + добавление `claudeFeedback()` в `plugins:[` с проверкой что ещё нет). Отвергнуто: AST-трансформер (тащит babel в CC-плагин ради простой вставки — регексп с idempotency-guard достаточно для типовых `vite.config`); запуск install из самого хука синхронно-блокирующе (делать в фоне нельзя — но install быстрый и разовый, ок синхронно с логом).

**Файлы:** Create `claude-plugin/hooks/session-start.sh`, `claude-plugin/scripts/wire.mjs`, `claude-plugin/scripts/unwire.mjs`, `claude-plugin/scripts/lib/vite-config-patch.mjs`, `claude-plugin/skills/claude-feedback/SKILL.md`, `claude-plugin/commands/feedback.md`, `claude-plugin/commands/feedback-setup.md`, `claude-plugin/commands/feedback-remove.md`; Modify `claude-plugin/.claude-plugin/plugin.json` (добавить mcpServers/hooks/skills/commands поверх Ф1-заглушки); Test `tests/unit/vite-config-patch.test.mjs`, `tests/unit/wire-detect.test.mjs`.

**Интерфейсы:** `vite-config-patch.mjs`: `addPlugin(source:string):{changed:boolean,result:string}`, `removePlugin(source:string):{changed:boolean,result:string}` — идемпотентные строковые трансформации. `wire.mjs`/`unwire.mjs` — CLI (читают `CLAUDE_PROJECT_DIR`/cwd).

**Шаги (TDD на трансформации):**

1. `vite-config-patch.test.mjs`: вход типовой `vite.config.ts` (`import vue from '@vitejs/plugin-vue'; export default defineConfig({plugins:[vue()]})`) → `addPlugin` вставляет import и `claudeFeedback()` в массив; повторный `addPlugin` → `changed:false` (идемпотентно); `removePlugin` убирает обе вставки; вариант с `plugins: []` пустым; вариант где массив многострочный. Реализовать `vite-config-patch.mjs`.
2. `wire-detect.test.mjs`: фейковая project-dir с `package.json`(vue+vite) + `vite.config.ts` → detect «vue+vite:true, wired:false»; после добавления dep+вставки → «wired:true»; project без vite → «not_vite» (abort-причина). Реализовать detect-часть `wire.mjs` (выделить чистую функцию `inspectProject(dir)` для тестируемости; install/git-часть — тонкая обёртка, не покрывается unit, проверяется в Ф7).
3. Написать `wire.mjs` (inspectProject + install + patch + лог), `unwire.mjs` (patch.removePlugin + uninstall dep). Install выбирает менеджер по lockfile (`pnpm-lock.yaml`/`package-lock.json`/`yarn.lock`).
4. `hooks/session-start.sh`: `#!/usr/bin/env bash`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/wire.mjs"` с `|| true` (никогда не ломать старт сессии) + лог в stderr.
5. `plugin.json`: `mcpServers:{ "claude-feedback":{ "command":"node", "args":["${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs"] } }`, `hooks:{ "SessionStart":[{ "hooks":[{ "type":"command", "command":"bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\"" }] }] }`, `skills:"./skills/"`, `commands:"./commands/"`. Версия синхронизируется husky.
6. `SKILL.md` (`claude-feedback`): когда/как — «когда пользователь упоминает, что прислал фидбэк из превью, или просит глянуть — вызови `get_feedback`; обработай каждый item (url/element/component/console); при необходимости дёрни `request_store_snapshot`/`request_component_snapshot`/`request_console`; для крупных фич/breaking при доработке самого плагина зови `pnpm release minor|major`».
7. Команды: `feedback.md` (вызвать `get_feedback` и начать работу), `feedback-setup.md` (запустить wire.mjs), `feedback-remove.md` (запустить unwire.mjs).
8. `pnpm test:run`. Commit.

**Edge-cases:**

- empty: пустой `vite.config` без `plugins` ключа → `addPlugin` добавляет `plugins:[claudeFeedback()]` (boundary), либо если структура нераспознана → лог «patch failed, добавь вручную: …», не падать.
- boundary: `vite.config.js`/`.mjs`/`.ts` — detect по всем расширениям; несколько конфигов → первый найденный, лог.
- concurrency: две сессии стартуют параллельно, обе зовут wire → idempotency-guard + `pnpm add` повторно безопасен (no-op если dep есть); патч повторно `changed:false`.
- external-failure: `git ls-remote` недоступен (нет сети) → wire логирует «не смог резолвить тег, пропускаю install» и не падает (хук `|| true`); `pnpm add` упал → лог, abort вайринга, старт сессии продолжается.
- malformed-input: vite.config с экзотическим синтаксисом, регексп не матчит `plugins:[` → лог-инструкция ручной вставки, exit 0.
- deleted-resource: нет `package.json` → «not a node project», no-op.
- permission: нет прав писать vite.config → лог-ошибка, no-op (не ломать сессию).

**Verify-гейт (исполняемый смоук):** `tests/smoke/wire-smoke.mjs` — создать врем. project-dir (package.json vue+vite + vite.config.ts), запустить `node claude-plugin/scripts/wire.mjs` с `CLAUDE_PROJECT_DIR=<tmp>` и **замоканным install** (env-флаг `CLAUDE_FEEDBACK_SKIP_INSTALL=1`, чтобы не лезть в сеть) → проверить, что vite.config пропатчен (содержит `claudeFeedback`); затем `unwire.mjs` → vite.config вернулся к исходному. Плюс валидировать manifest: `node -e "JSON.parse(fs.readFileSync('claude-plugin/.claude-plugin/plugin.json'))"` ок и содержит mcpServers+hooks. Печатает `wire-smoke ok`. Плюс `pnpm test:run` зелёный.

**Контракт для следующих фаз:** CC-плагин полностью собран и устанавливаем через marketplace. `wire.mjs` поддерживает `CLAUDE_FEEDBACK_SKIP_INSTALL=1` для тестов. `следующий шаг: Ф7 ставит реальный demo-app, прогоняет полный e2e (Alt+C → get_feedback → snapshot).`

---

## Фаза 7 — demo-app + e2e harness

<!-- circle: status=pending order=70 deps=[4,5,6] autonomy=auto obstacle="" -->

**Цель фазы:** полноценное demo-приложение Vue 3 + Vite + Pinia и закоммиченный headless-e2e, прогоняющий весь поток включая snapshot Pinia-стора и MCP-инструменты.

**Подход (выбран):** `examples/demo-app/` — минимальное Vite-Vue-приложение с Pinia-стором (`counter`) и парой компонентов, подключающее локальный плагин через `vite-plugin-claude-feedback` (file-ссылка на корень репо, не github — для разработки). E2E на **headless Playwright** (зеркалит verify-дисциплину workflow-rules), harness в `tests/e2e/`. Отвергнуто: e2e через MCP-клиента из sdk поверх запущенного dev (дороже) — достаточно дёргать bridge `/api/*` напрямую по localhost для проверки контракта, а MCP-слой покрыт смоуком Ф5.

**Файлы:** Create `examples/demo-app/` (`package.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/App.vue`, `src/components/Counter.vue`, `src/stores/counter.ts`), `tests/e2e/feedback.e2e.mjs`, `tests/e2e/README.md`, `scripts/e2e.sh`.

**Интерфейсы (Consumes):** Vite-плагин (Ф4) через локальную ссылку; bridge `/api/*` (Ф2); коллекторы/оверлей (Ф3/Ф4); `snapshotStore` против реального Pinia (Ф3).

**Шаги:**

1. Собрать `examples/demo-app` (vue+vite+pinia, `counter` store с `count`/`increment`, Counter.vue использует store, App.vue монтирует). vite.config подключает `claudeFeedback()` через relative import корневого `dist/` (или `file:..` dependency). `npm view` версий vue/vite/pinia/@vitejs/plugin-vue перед добавлением (свежие).
2. `scripts/e2e.sh`: `pnpm build` (корень) → запустить demo dev-сервер на свободном порту (background, дождаться готовности по HTTP) → `node tests/e2e/feedback.e2e.mjs PORT` → прибить dev-сервер.
3. `feedback.e2e.mjs` (Playwright chromium): открыть demo → assert HTTP 200, console clean, shadow-root присутствует. Эмулировать Alt+C → модалка. Включить picker → кликнуть по Counter-кнопке → assert тултип/выбор показывает компонент `Counter`. Ввести текст → «Отправить». Прочитать `bridge.json` demo → `GET http://localhost:<bridgePort>/__claude_feedback/api/feedback?ack=1` → assert payload: `url` верный, `component.name==='Counter'`, `component.file` содержит `Counter.vue`, `element.tag==='button'`, `console` присутствует. Затем нажать increment в UI, `POST /api/request {kind:'store',args:{store:'counter'}}` → assert `state.count` отражает клики. Assert `vite build` demo не инжектит оверлей (отдельная проверка: собрать demo, grep в `dist` нет `__claude_feedback`). Печатать `e2e ok`.
4. Зафиксировать стратегию запуска тестов в `README.md`/корневом doc, если full-suite > 2 мин.
5. Commit (harness в репо — переиспользуется).

**Edge-cases (e2e покрывает реальные):**

- empty: отправка без выделения и без текста → payload с `element:null`, `message:''`, `console` непустой — assert принят.
- boundary: большой console-буфер (нагенерить >200 логов в demo) → в payload ровно последние N (кольцо).
- concurrency: два snapshot-request подряд по localhost → оба корректны.
- external-failure: остановить dev-сервер и дёрнуть `/api/feedback` → connection refused (демонстрирует, что MCP отдал бы `bridge_not_running`).
- malformed-input: `POST /api/request` с несуществующим стором `{store:'nope'}` → `{error:'not_found',available:['counter']}`.
- deleted-resource: `request_component_snapshot {selector:'#gone'}` → `{error:'not_found'}`.
- browser/UX: refresh demo → оверлей переинициализируется, WS reconnect, повторный Alt+C работает.
- prod: demo `vite build` → нет инжекта (assert в шаге 3).

**Verify-гейт (исполняемый смоук):** `bash scripts/e2e.sh` → `e2e ok`, exit 0. Это и есть полный end-to-end на реальном vue+vite+pinia. Плюс весь `pnpm test:run` зелёный. Если playwright-chromium не установлен — `npx playwright install chromium` (часть harness, не повод сдаться).

**Контракт:** инструмент проверен end-to-end; harness закоммичен. `следующий шаг: тег версии актуален (husky); репо готово к `git push --follow-tags` и установке через marketplace.`

---

## Журнал

### Фаза 1 — Инфра (done, 2026-06-26)

Собран каркас репо: `package.json` (exports/main/types→`dist/`, peer `vite>=5`), `tsconfig.json`+`tsconfig.dts.json`, скрипты версионности (`version-sync.mjs`/`check-versions.mjs`/`release.mjs` — чистый Node, semver-бамп инлайн, без deps), husky `.husky/{pre-commit,post-commit}`, `.claude-plugin/marketplace.json`, `claude-plugin/.claude-plugin/plugin.json` (с полем `version`), README с install-инструкциями, `.gitignore` (dist НЕ игнорится).

**Отклонение от плана (важно для Ф2+):** план называл **tsup** как сборщик, но tsup ОТСУТСТВУЕТ в офлайн-сторе pnpm этой машины, а сеть до npm крайне медленная/флапает. Зато `esbuild@0.27.2` + `typescript@5.9.3` (и все прочие deps) в сторе есть. Поэтому сборка сделана через **esbuild (bundle) + tsc (dts)** в `scripts/build.mjs` — контракт идентичен: `pnpm build` → `dist/{index.js (ESM, ws будет бандлиться), client.js (IIFE), index.d.ts}`. `tsup.config.ts` НЕ создавался. Для Ф2+ это прозрачно: build-команда и выход те же. Если позже понадобится фича tsup — добавить как devDep когда сеть доступна.

**Установка deps:** `pnpm install --offline` падает (метадата-mirror пустой для большинства пакетов), но `pnpm install --prefer-offline` отрабатывает за ~10с (тарболлы из стора, метадата из сети — сеть после прогрева быстрая, 1–4с/пакет). Пин версий ТОЧНЫЙ (совпадает со стором). `@modelcontextprotocol/sdk` (нужен Ф5) и `tsup` в сторе ОТСУТСТВУЮТ — Ф5 потребует сетевой install sdk (сеть рабочая).

**Verify (всё зелёное, исполнено реально):** `pnpm build` → три dist-файла; `import('./dist/index.js').default().name` === `vite-plugin-claude-feedback` («plugin ok»); `check-versions` exit 0; `release.mjs patch` → 0.0.2 во всех 3 манифестах → revert → 0.0.1; edge: bad-arg→exit1, divergence→exit1, `test:run`→passWithNoTests exit0. Тег `v0.0.1` создан post-commit-хуком на первом коммите. **Доп. смоук авто-версионности (контракт для всех след. фаз):** второй коммит с правкой `src/` → pre-commit реально бампнул 0.0.1→0.0.2, синкнул манифесты, пересобрал+застейджил `dist/`, post-commit поставил `v0.0.2`; дерево чистое, оба тега на месте. Первый коммит (нет HEAD-версии=рабочей) НЕ бампит — guard работает.

**Откатов не было.** Репо сейчас на `v0.0.2` (стартовый `v0.0.1` тоже существует — требование шага 9 выполнено). Коммиты: `38e9c25` (scaffold) + `ca2c1c3` (named export, заодно проверил bump-path).

**Следующий шаг:** Ф2 и Ф3 могут стартовать параллельно (обе deps=[1]). Build-команда `pnpm build`, выход `dist/{index.js,index.d.ts,client.js}`, авто-версионность активна (просто коммить — версия бампается сама). Внимание Ф2: bridge будет тащить `ws` (8.19.0 в сторе) — esbuild с `platform:node` бандлит ws в `dist/index.js`, node-билтины остаются external, `vite` тоже external. Внимание Ф5: `@modelcontextprotocol/sdk` НЕ в офлайн-сторе — заложи время на сетевой install.

### Фаза 2 — Server: bridge + queue (done, 2026-06-26)

Построено: `src/server/types.ts` (FeedbackPayload/ConsoleEntry/SnapshotRequest/BridgeInfo по спеке), `src/server/queue.ts` (`createQueue(dir,{maxItems})` — append-only JSONL + tombstone-ack `{__ack:id}`, in-memory зеркало, replay со скипом битых строк, drop-oldest cap по maxItems=1000), `src/server/bridge.ts` (`createBridge`/`createStandaloneBridge`). Bridge: один http-роутер + один `WebSocketServer({noServer})`, upgrade строго на `/__claude_feedback/ws`; `requestSnapshot` шлёт WS-`request` первому коннекту, ждёт `reply` по requestId с таймаутом (default 10000, тест на 50мс), reject `{code:'timeout'|'browser_not_connected'}`; HTTP: `POST /message` (cap→413, bad-json→400), `GET /api/feedback?ack=1`, `POST /api/request` (kind-валидация→400), `GET /api/status`; `writeBridgeInfo` атомарно (tmp+rename), при unwritable dir не крашит.

**Контракт-уточнения (важно для Ф4/Ф5):**

- `createStandaloneBridge(opts)` возвращает **Promise** `{bridge,server,port,close}` (порт известен только после `listen`) и САМ зовёт `writeBridgeInfo(port)` после bind — зеркалит то, что Ф4 сделает в `configureServer`.
- WS-протокол как в плане: reply идёт **по WS** (`{type:'reply',requestId,data?,error?}`), НЕ через `POST /reply` (в спеке упоминался POST — план его переопределил, следовал плану).
- Snapshot-failure возвращается с HTTP **200** + `{error:code}` (bridge отработал, браузер — нет); bridge-ошибки (нет файла/refused) — это уже забота bridge-client Ф5.
- `tabs`-реестр ключуется **server-side connId**, не клиентским `tabId` (тот только в `status().tabs`). Ф4-клиент шлёт `hello{tabId,url}` как обычно.

**Отклонение verify-гейта (учти для Ф5):** план звал смоук «поднять createStandaloneBridge из dist» — но в Ф2 сборка `dist/index.js` бандлит только плагин (он ещё НЕ импортит bridge, это Ф4), серверного JS в dist нет. Смоук `tests/smoke/bridge-smoke.mjs` поэтому сам бандлит `src/server/bridge.ts` через esbuild в temp-ESM и гоняет реальный round-trip (POST→ack→WS snapshot). **Грабли (must для Ф4):** esbuild ESM-вывод оборачивает `require()` из `ws` в шим, падающий на `Dynamic require of "events"`. Фикс — banner `import {createRequire as __cr} from 'module'; const require=__cr(import.meta.url);`. В смоуке он есть; **когда Ф4 заставит `scripts/build.mjs` бандлить bridge в `dist/index.js` (ESM) — тот же banner обязан попасть в build.mjs**, иначе рантайм-плагин упадёт на старте dev-сервера.

**Self-review (1 проход, 2 сабагента):** применены — connId-ключ реестра (фикс ABA/eviction по дубль-tabId), loopback+Host-allowlist на `/api/*` (защита от `--host`-экспозиции и DNS-rebinding), WS `maxPayload=256K`, queue `maxItems`-cap (DoS), kind-валидация, mkdir один раз, sendJson stringify-guard, exact ws-path, ws error-log. **Отложено в Ф4/Ф5 (обоснованно):** Origin-allowlist на WS-upgrade — нужен expected-origin из Vite-конфига, есть только у Ф4 (connId-ключ уже убрал eviction-вектор; остаётся лишь «атакующий-таб отвечает на snapshot», требует выигрыша гонки first-tab); per-field shape-валидация element/component и demarcation untrusted-данных для LLM — поверхность Ф4 (контракт payload) и Ф5 (MCP). JSONL-компакция на диске — это явное design-решение плана (append-only + tombstone), не дефект.

**Verify (всё зелёное, исполнено реально):** `pnpm test:run tests/unit` → 26 passed (queue 9 + bridge 17, вкл. edge: empty/boundary/concurrency/external-failure/permission/malformed-input/deleted-resource); `node tests/smoke/bridge-smoke.mjs` → `bridge-smoke ok`; `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → три dist-файла. **Откатов не было.** Husky на коммите `c139e33` бампнул 0.0.2→0.0.3, пересобрал dist, тег `v0.0.3`.

**Следующий шаг:** Ф4 (deps[2,3]) монтирует bridge в Vite: `configureServer(server)` → `server.middlewares.use(bridge.httpMiddleware)` + `server.httpServer.on('upgrade', bridge.handleUpgrade)` + `bridge.writeBridgeInfo(actualPort)`; `buildEnd/closeBundle`→`bridge.close()`. НЕ забудь createRequire-banner в `scripts/build.mjs` (см. грабли выше). Ф5 (deps[2]) дёргает `/api/*` по localhost из bridge.json; помни про loopback+Host-гейт — MCP-клиент шлёт Host `127.0.0.1:<port>`.

### Фаза 3 — Client collectors (done, 2026-06-27)

Построены 4 чистых клиентских модуля (потребляет Ф4): `src/client/safe-stringify.ts` (`safeStringify(value,{maxDepth=6,maxLen=5000,maxNodes=50000})` — cycle-guard через ancestor-Set, node-budget против wide/DAG-DoS, NaN/±Inf→строки, Date/RegExp/Error→читаемо, Map с object-ключами→`[key#i]` без коллизии, `__proto__`-safe assign, DOM→`[DOM:tag]`, fn/symbol/bigint-плейсхолдеры); `src/client/resolve-component.ts` (`resolveComponent(el)` — подъём по `el.__vueParentComponent.parent` до первого с `type.__file`, имя `name||__name||basename(__file)`, guard 1000; `describeElement(el)` — tag/classes/trimmed-text/CSS-path с `:nth-of-type` и `#id`-short-circuit; экспортит `componentName(inst)` для Ф4); `src/client/console-tap.ts` (`installConsoleTap(size=200)` — tee-обёртка `console.{log,info,warn,error,debug}` + window `error`/`unhandledrejection`, кольцевой буфер, per-entry cap 8000, LIFO-dispose восстанавливает install-time оригиналы); `src/client/snapshot.ts` (`snapshotStore({store?})`/`snapshotComponent({selector?,last?},lastEl?)` — Pinia через `__VUE_DEVTOOLS_GLOBAL_HOOK__` (apps→`app.config.globalProperties.$pinia` / `_instance.appContext`), structured-error degrade `no_pinia`/`not_found`+available, querySelector в try/catch).

**Контракт-уточнения (важно для Ф4):**

- `resolveComponent` возвращает `ComponentDescriptor` (из `src/server/types.ts`) — `{name, file:string|null, chain:string[]}`; `null` при `el===null` ИЛИ отсутствии `__vueParentComponent` (элемент вне Vue-приложения / Shadow DOM). `file` — это сырой `type.__file` без `:line` (строки на этом слое нет; Ф4 при желании добьёт).
- `snapshotStore` БЕЗ `store` → `{stores:[...]}` (список id); нет devtools-хука → `{error:'no_pinia'}` (НЕ `{stores:[]}` — выбрал явную причину, см. отвергнутую альтернативу ниже).
- `snapshotComponent` читает `props` + merged `{...data, ...setupState}` (setupState выигрывает на коллизии). `last:true` без `lastEl` → `{error:'not_found'}`. Малформ-селектор / нет матча / нет инстанса → `{error:'not_found'}`.
- `installConsoleTap` — `getBuffer()` отдаёт **копию** (slice), уровни строго `log|info|warn|error|debug` (window-error и rejection пишутся как `error`). Ф4 зовёт `getBuffer()` на «Отправить» и кладёт в `FeedbackPayload.console`.

**Решение (делаю X вместо Y):** `snapshotStore` без хука отдаёт `{error:'no_pinia'}`, а не `{stores:[]}` — пустой список неотличим от «Pinia есть, стораов нет», а явная причина даёт Ф5/Claude понятный сигнал «открой превью / подключи Pinia». Тестовое окружение — per-file `// @vitest-environment happy-dom` докблок (НЕ глобальный vitest.config), чтобы серверные тесты Ф2 остались на node-дефолте — вместо добавления `environmentMatchGlobs` (deprecated в vitest 4) или раздельных конфигов.

**Self-review (1 проход, 2 сабагента — code+security):** применены — node-budget `maxNodes` (security MEDIUM: wide/DAG-DoS, `[Circular]` не ловит siblings), per-entry text-cap 8000 в console-tap (MEDIUM: unbounded память/payload), NaN/Inf→строки и Date/RegExp/Error-ветки (MAJOR/MINOR: тихое искажение `→null`/`→{}`), Map object-key collision fix (MAJOR), `__proto__`-safe assign (LOW prototype-pollution, contained), ancestor-Set вместо O(n²) includes, `||`-fallback для пустого ErrorEvent.message, LIFO-dispose NOTE. **Отклонено/отложено (обосновано):** redaction секретов/PII перед уходом в LLM (security MEDIUM, `console-tap.ts`/`snapshot.ts`) — это явно поверхность Ф4 (контракт payload) / Ф5 (MCP demarcation) по решению Ф2-журнала, не слой коллекторов; Ф4 ОБЯЗАН добавить redactor (regex `*token*|*secret*|*password*|*api[_-]?key*|authorization|cookie|JWT eyJ…`) на `getBuffer()`-выход и snapshot-стейт перед `POST /message`. resolve-component параллельно clean (guard достаточен, regex линейны, querySelector без инъекции/ReDoS).

**Verify (всё зелёное, исполнено реально на happy-dom):** `npx vitest run tests/unit/{safe-stringify,resolve-component,console-tap,snapshot}.test.ts` → 36 passed (8+10+7+11, edge: empty/boundary/concurrency/external-failure/permission-N-A/malformed-input/deleted-resource + browser-Shadow-DOM-null); `pnpm test:run tests/unit` → 69 passed (без регресса Ф2); `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → три dist-файла. **Откатов не было.** Husky на коммите `6bc385e` бампнул 0.0.3→0.0.4, пересобрал dist, тег `v0.0.4`, дерево чистое.

**Следующий шаг:** Ф4 импортит `resolveComponent`/`describeElement`/`installConsoleTap` для сборки `FeedbackPayload` и `snapshotStore`/`snapshotComponent` для ответа на WS-`request`. Коллекторы НЕ импортятся из `dist/` (это client-TS, бандлится в `dist/client.js` только когда `src/client/index.ts` их подтянет в Ф4) — Ф4 импортит их по relative-path из `src/client/`. **Must для Ф4 (из security-review):** redactor секретов на console-буфер и snapshot-выход перед отправкой в очередь.

### Фаза 4 — Client overlay + Vite plugin entry (done, 2026-06-27)

Построено: `src/client/redact.ts` (security-must из Ф3 — `redactString` маскирует JWT/`Bearer …`/`key=value` для sensitive-ключей, `redactDeep` маскирует значения под sensitive-КЛЮЧАМИ + redact текста, depth-bound 12; `redactConsole` по строкам entry); `src/client/ws-client.ts` (`createWsClient` — `hello` на open, `request{console|store|component}` → локальный коллектор → `reply` с **редактированными** data, reconnect с capped-backoff 1s→10s, фабрика WS инъектится для тестов); `src/client/overlay.ts` (`createOverlay` — Shadow-DOM модалка [textarea+Выделить/Отправить/Отмена], element-picker на capture-listeners с hover-box+component-tooltip, click-select/Esc-cancel, `composedPath`-guard на собственный UI, payload-сборка [url/describeElement/resolveComponent/redactConsole(getBuffer)], 413→«слишком большой», offline→ошибка, double-submit блок, idempotent open); `src/client/index.ts` (bootstrap: cfg из `window.__CLAUDE_FEEDBACK_CFG__`, tap, ws, Alt+C на capture, last-el через `overlay.lastEl()`, single-boot guard); `src/plugin/index.ts` (полная реализация: `config`→build-gating, `transformIndexHtml{order:'pre'}`→инлайн `dist/client.js`+cfg, `configureServer`→`middlewares.use(httpMiddleware)` + **path-gated** `upgrade`→`handleUpgrade` (не глушить Vite HMR!) + `writeBridgeInfo(actualPort)` на `listening`, `buildEnd/closeBundle`→close).

**Отклонения (важно для Ф5–Ф7):**

- **Verify-смоук: Playwright → реальный Vite-dev-сервер.** Playwright/chromium НЕТ в офлайн-сторе (как tsup в Ф1), сеть флапает. Но `vite` — devDep и стоит. `tests/smoke/overlay-smoke.mjs` поднимает НАСТОЯЩИЙ `vite.createServer` с собранным dist-плагином против `tests/smoke/dev-app/` (plain html+ts, без vue — полный Pinia-demo это Ф7) и проверяет реальный dev-контракт: документ инлайнит client+cfg; `bridge.json` с живым портом; feedback `POST /message`→drain round-trip; snapshot без браузера→`browser_not_connected`; `vite build`→НЕ инжектит. Браузерный JS оверлея (Alt+C/shadow/picker/WS-reply) покрыт happy-dom юнит-тестами. Смоук идёт ~1 мин (vite dev+build) — НЕ хэнг.
- **build.mjs: createRequire-banner добавлен** в plugin-сборку (Ф2-грабли реализованы) — плагин теперь бандлит bridge→ws; без banner рантайм падал бы на `Dynamic require of events`. Плюс dts: plugin импортит `../server`, поэтому dts-программа = `src/{plugin,server}`, `rootDir:"src"`, tsc эмитит дерево под `dist/`, build.mjs переносит `dist/plugin/index.d.ts`→`dist/index.d.ts` и чистит остальное. Публичный type-surface НЕ ссылается на server-типы → `index.d.ts` самодостаточен (проверено).
- **WS-upgrade обязан гейтиться по пути в configureServer** (НЕ передавать `bridge.handleUpgrade` напрямую в `on('upgrade')`): bridge при чужом пути делает `socket.destroy()` → убил бы Vite HMR. В плагине: `if (path===WS_PATH) bridge.handleUpgrade(...)`. Грабля для любого, кто будет монтировать bridge.

**Контракт для Ф5/Ф7:** dev-сервер пишет `.claude-feedback/bridge.json` реальным портом; HTTP `/api/*` под loopback+Host-гейтом (Ф5 MCP шлёт Host `127.0.0.1:<port>`). Конфиг клиента — `window.__CLAUDE_FEEDBACK_CFG__={hotkey,consoleBufferSize}`. WS reply-data уже редактированы (Ф5 НЕ должен повторно).

**Self-review (1 проход):** redactor покрывает оба вектора Ф3-security (console + snapshot). Open-вопросы отложены обоснованно: Origin-allowlist на WS-upgrade (Ф2 отложил в Ф4 — но requires expected-origin из vite-конфига; connId-ключ уже убрал eviction, остаётся лишь «атакующий-таб выигрывает гонку first-tab на snapshot» — низкий риск на localhost-dev; не блокер, оставляю Ф7 e2e подтвердить реальный прокси-путь); per-field shape-валидация element/component payload — bridge уже строкифицирует поля через `String()`, глубокая валидация не критична для dev-инструмента.

**Verify (всё зелёное, исполнено реально):** `pnpm test:run` → **99 passed** (10 файлов: +redact 11, +ws-client 9, +overlay 9, +plugin-transform 5 поверх Ф1–Ф3 69; edge: empty/boundary/concurrency/external-failure/malformed-input/deleted-resource/double-submit/413/offline/own-UI-click-ignore); `node tests/smoke/overlay-smoke.mjs` → `overlay-smoke ok` (реальный Vite dev+build); `node tests/smoke/bridge-smoke.mjs` → `bridge-smoke ok` (без регресса Ф2); `tsc -p tsconfig.json --noEmit` → exit 0; `pnpm build` → три dist-файла, `index.d.ts` чистый, banner на месте. **Откатов не было.** Husky на коммите `33a64da` бампнул 0.0.4→0.0.5, пересобрал dist, тег `v0.0.5`, дерево чистое.

**Следующий шаг:** Ф5 (deps[2]) — stdio MCP-сервер `claude-plugin/mcp-server.mjs` дёргает `/api/*` по localhost из `bridge.json`; помни Host-гейт. **Грабля Ф1:** `@modelcontextprotocol/sdk` НЕ в офлайн-сторе — заложи время на сетевой install (`pnpm add`). Ф7 переиспользует `overlay-smoke`-подход (реальный Vite, без Playwright) на полноценном vue+pinia demo-app — picker/Alt+C/WS-snapshot гонять либо через claude-in-chrome, либо доустановив playwright если сеть позволит.

### Фаза 5 — MCP server (stdio → bridge) (done, 2026-06-27)

Построено: `claude-plugin/lib/bridge-client.mjs` (`readBridgeInfo(projectDir)` — парсит `.claude-feedback/bridge.json`, null при missing/malformed/нет числового `port`; `callBridge(method,path,body?,{projectDir})` через `node:http` — re-читает bridge.json КАЖДЫЙ вызов [без своего состояния → рестарт dev-сервера с новым портом подхватывается], ставит `Host: 127.0.0.1:<port>` под loopback-гейт bridge, маппит: 2xx→`{ok,data}`, 4xx/5xx→`{error:'bridge_error'}`, ECONNREFUSED/timeout/нет-файла→`{error:'bridge_not_running'}`, невалидный JSON-body→`bridge_error`), и `claude-plugin/mcp-server.mjs` (5 инструментов: `get_feedback`→`GET /api/feedback?ack=1`, `request_store_snapshot{store?}`/`request_component_snapshot{selector?,last?}`/`request_console{level?}`→`POST /api/request {kind,args}`, `feedback_status`→`GET /api/status`). Инструменты НИКОГДА не throw: bridge-ошибка → дружелюбный `isError`-результат «запусти dev-превью/открой вкладку, потом повтори»; браузер-ошибка из `data.error` (`timeout`/`browser_not_connected`/`closing`) → отдельный человекочитаемый текст; `get_feedback` на пустой очереди → `{items:[],note}`.

**Решение (делаю X вместо Y):** взял **низкоуровневый `Server`** (`@modelcontextprotocol/sdk/server/index.js`) + `setRequestHandler(List/CallToolRequestSchema)` с **plain JSON-Schema** `inputSchema`, а НЕ высокоуровневый `McpServer`. Причина: `McpServer.registerTool` описывает входы zod-shape'ами, но `zod` — лишь транзитивная зависимость SDK и под pnpm НЕ резолвится из моего файла (`import 'zod'`→`ERR_MODULE_NOT_FOUND`). `Server` помечен `@deprecated` мягко («use McpServer for high-level API; Server for advanced use cases») — наш случай ровно «advanced», zero extra deps. Парсинг args — вручную из `req.params.arguments`. SDK поставлен сетевым `pnpm add` (`@modelcontextprotocol/sdk@1.29.0`, как и предсказал журнал Ф1; пин выправлен `^`→точный `1.29.0` под конвенцию репо), лёг в `dependencies` (рантайм-деп).

**ВНИМАНИЕ Ф6 (packaging-риск, НЕ дефект кода — в scope Ф6/манифест):** `mcp-server.mjs` `import`-ит `@modelcontextprotocol/sdk`, который резолвится из `node_modules` репо. При установке CC-плагина через marketplace `${CLAUDE_PLUGIN_ROOT}` = `claude-plugin/` — node будет искать `@modelcontextprotocol/sdk` вверх по дереву; если marketplace-install НЕ приносит `node_modules`, рантайм `node mcp-server.mjs` упадёт на `ERR_MODULE_NOT_FOUND`. Ф6 (владелец plugin.json/упаковки) ОБЯЗАН решить: либо забандлить sdk в self-contained `mcp-server.mjs` через esbuild (как `dist/`; тогда план-пункт «.mjs без сборки» уточняется), либо `claude-plugin/package.json` с депом + install-шаг, либо вендоринг. Я НЕ менял design плана автономно — флагую тут, верифицированный сервер исполняется из репо.

**Verify-гейт (исполнено реально, всё зелёное):** TDD — `tests/unit/mcp-bridge-client.test.mjs` написан ПЕРВЫМ (8 тестов: present/missing/malformed bridge.json, GET-data+loopback-Host-assert, POST-body, bridge_not_running при отсутствии файла, bridge_error на 500, bridge_not_running на refused-port, bridge_error на не-JSON; edge: empty/boundary/external-failure/malformed-input/deleted-resource) → fail (нет модуля) → реализация → зелёный. Смоук **полного MCP round-trip** `tests/smoke/mcp-smoke.mjs`: фейк-bridge (http, enforce-Host-гейт) + bridge.json в temp-dir → `mcp-server.mjs` поднят РЕАЛЬНЫМ дочерним процессом через `StdioClientTransport`, прогон `initialize`+`tools/list`(=5 инструментов)+`feedback_status`+`get_feedback`(drain→ack→пусто)+`request_console`/`request_store_snapshot`(forward kind+args, unwrap `{data}`)+offline-bridge→`isError`-результат → `mcp-smoke ok`. Плюс `node --check` обоих `.mjs`. Регресс-прогон: `pnpm test:run` → **107 passed** (11 файлов: +mcp-bridge-client 8 поверх Ф1–Ф4 99); `node tests/smoke/bridge-smoke.mjs`→`bridge-smoke ok`, `node tests/smoke/overlay-smoke.mjs`→`overlay-smoke ok` (без регресса); `tsc -p tsconfig.json --noEmit`→exit 0; `pnpm build`→три dist-файла. **Откатов не было.** Husky на коммите `3fccc9c` бампнул 0.0.5→0.0.6, синкнул манифесты, пересобрал+застейджил dist, тег `v0.0.6`, `check-versions ok`, дерево чистое.

**Следующий шаг:** Ф6 (deps[5]) — `plugin.json mcpServers:{ "claude-feedback":{ command:"node", args:["${CLAUDE_PLUGIN_ROOT}/mcp-server.mjs"] } }` + SessionStart-хук/wire/unwire/skill/commands. **Сначала реши packaging-риск sdk выше** (иначе MCP-сервер не стартует у установившего плагин). Имена инструментов для SKILL.md/commands зафиксированы: `get_feedback`, `request_store_snapshot`, `request_component_snapshot`, `request_console`, `feedback_status`. `CLAUDE_PROJECT_DIR` — откуда сервер берёт `.claude-feedback/bridge.json` (env, fallback cwd).
