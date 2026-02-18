# AI Mistakes Log — AEGIS

Это файл ошибок которые Claude Code повторяет. ЧИТАЙ ПЕРЕД КАЖДЫМ ИЗМЕНЕНИЕМ.

## CSS / Стили
1. Добавляет text-transform: uppercase на h2 глобально — ломает settings/modal headers
2. Удаляет существующие hover states и transitions когда "улучшает" CSS
3. Ставит overflow: hidden вместо overflow: auto — контент обрезается
4. Меняет переменные в variables.css без проверки где они используются

## Безопасность
5. Пишет innerHTML без escaping — XSS risk (threat-analysis.js прецедент)
6. Использует inline onclick вместо addEventListener
7. Не экранирует пользовательский ввод в генерируемом HTML

## Логика
8. Классифицирует .json/.yaml как "sensitive config" — слишком агрессивно
9. Не дедуплицирует события — один файл triggers 100+ alerts
10. sensitive * 10 = линейный рост без предела — risk мгновенно 100

## Общее поведение
11. Добавляет фичи которые не просили (hamburger menus, анимации, responsive)
12. Забывает обновить exports.js при добавлении нового IPC channel
13. Пишет React/Svelte паттерны вместо vanilla JS — renderer использует глобальные функции через script tags, НЕ фреймворки
14. Создаёт мёртвый код — функции которые нигде не вызываются
15. Double-encodes UTF-8 — вместо – (en dash)

## Документация
16. Оставляет устаревшие ссылки на Svelte/Vite в README и architecture.md после перехода на vanilla JS
17. Описывает Project Structure с файлами которых нет (App.svelte, lib/components/, lib/stores/)
18. Не синхронизирует количество агентов между README badges, CLAUDE.md и agent-database.json

## Правило
НИКОГДА не меняй то, что я не просил менять. Делай ТОЛЬКО то что написано в промте.