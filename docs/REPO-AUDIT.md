# Полный аудит GitHub-репозитория AEGIS

Этот отчет содержит анализ текущего состояния документации, настроек и файлов сообщества репозитория, а также список того, что необходимо исправить или добавить.

## 1. README.md: что устарело?
- **Количество агентов:** В `README.md` указано 94 агента, однако `CHANGELOG.md` (0.2.0-alpha) говорит об увеличении до 95, а `AGENTS.md` заявляет 98 агентов. Необходимо синхронизировать цифры.
- **Пути к скриншотам:** `README.md` до сих пор ссылается на старые изображения из папки `screenshots/` (например, `![Activity Feed](screenshots/activity-feed.png)`). Следует обновить пути, чтобы они вели на актуальные скриншоты нового Svelte-интерфейса в `docs/screenshots/` (например, `01-shield-tab.png`). Главный `screenshot.png` в корне также нужно проверить на актуальность.
- **Количество тестов:** Указано 130 тестов. Это значение стоит актуализировать, учитывая недавние масштабные изменения и переписывание на Svelte 5.
- **Особенности и платформы (Features / OS):** В разделе скачивания указано "Mac and Linux are supported experimentally", но в Roadmap пункты по Mac/Linux всё ещё не отмечены чекбоксами. Нужно привести это в соответствие (особенно учитывая, что changelog упоминает macOS build). 

## 2. package.json
- **keywords:** ✅ Указаны (`["ai", "security", "monitoring", "electron", "oversight", "agents", "privacy"]`)
- **homepage:** ✅ Указан (`"https://github.com/antropos17/Aegis"`)
- **bugs URL:** ✅ Указан
- **repository URL:** ✅ Указан

## 3. Настройки GitHub Repo
- **topics:** ✅ Присутствуют (`ai-agents`, `cybersecurity`, `developer-tools`, `electron`, `monitoring`, `open-source`, `privacy`, `ai-security`)
- **description:** ✅ Присутствует ("Independent AI Oversight Layer — monitors what AI agents do on your computer...")
- **website URL:** ❌ **Отсутствует** в настройках About на главной странице репозитория (в данных API ссылка пустая, хотя в самом `package.json` она есть). Необходимо добавить URL-адрес в панель настроек (About) справа в репозитории.

## 4. Community Health Files (чего не хватает)
Базовые файлы на месте (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR шаблоны), но не хватает следующих:
- ❌ **`FUNDING.yml`**: Важный механизм для поддержки открытых проектов (добавление кнопок GitHub Sponsors, Patreon, Ko-fi).
- ❌ **`CODEOWNERS`**: Крайне полезно для автоматизации назначения ревьюеров в pull request'ах.
- ❌ **`SUPPORT.md`**: Нужен для описания каналов поддержки, чтобы снизить нагрузку на раздел Issues.

## 5. Наличие GIF/видео демо
- ❌ **Отсутствует.** В топовых open-source проектах прямо под заголовком `README.md` обычно находится анимированная GIF-демонстрация или короткое видео `.mp4`, мгновенно показывающие работу и ценность продукта (в данном случае радар и сканирование). AEGIS имеет только статические `.png`.

## 6. Раздел Contributors в README
- ❌ **Отсутствует.** Сейчас есть только раздел "Author" (Built by Ruslan Murtuzaliyev). В README нет визуальной секции «Contributors» с аватарками. Использование ботов вроде `@all-contributors` или `contrib.rocks` сильно помогает мотивировать внешних разработчиков.

## 7. Бейджи (Badges)
- **Текущие бейджи:** License (MIT), Platform (Windows), Electron (33), Agents count, Downloads, CI (GitHub Actions).
- **Чего не хватает / стоит добавить:**
  - `Version` (текущая версия релиза GitHub или package.json).
  - `Code Coverage` (учитывая, что используется Vitest с v8 coverge, идеальными кандидатами стали бы Codecov или Coveralls).
  - `Community / Chat` (бейджик Discord или Telegram, если таковые есть).
  - `PRs Welcome` (хороший тон для open-source).

## 8. Состояние Changelog
- ✅ **Актуален.** `CHANGELOG.md` полностью обновлен до последней версии `0.2.0-alpha` (от 24 февраля 2026), где детализированы перенос приложения на архитектуру Svelte 5 / Vite 7 и запуск новой системы мониторинга.

## 9. Очистка старых файлов (screenshots/ vs docs/screenshots/)
- ❌ **Резервные и старые файлы:** В корневой папке `screenshots/` по-прежнему лежат старые (legacy) скриншоты (`activity-feed.png`, `settings.png`). При этом все актуальные интерфейсы перерисованы и выложены в `docs/screenshots/`.
- **Что исправить:** Полностью удалить старую директорию `screenshots/`, а в файле `README.md` массово заменить пути к изображениям на `docs/screenshots/...`.

## 10. Версия в Footer.svelte
- ❌ **Захардкожена.** В файле `src/renderer/lib/components/Footer.svelte` (строка 72) версия жестко прописана статичным текстом: `<span class="footer-version">AEGIS v0.2.0-alpha</span>`.
- **Что исправить:** Версия должна быть динамической и извлекаться автоматически во время сборки — например, пробрасываться через `import.meta.env` средства Vite (через плагин `vite-plugin-version-mark` или определение `__APP_VERSION__` в конфигурации) либо считываться через IPC напрямую из процесса Node.
