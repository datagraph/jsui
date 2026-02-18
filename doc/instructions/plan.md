---
name: JS SPA Port
overview: Recreate the full user-facing dydra-rails-20161201 UI in a vanilla JS single-page client in the jsui workspace, matching layout and CSS, and scaffold a class library for UI/model with an RDF persistence adapter.
todos: []
---

# Vanilla JS SPA Port

## Approach

- Rebuild the Rails layout structure (header/navigation, footer, main content/aside) from HAML into static HTML templates and client-side route rendering, matching `app/views/layouts` and shared partials.
- Mirror all user-facing routes from `config/routes.rb` as SPA routes, rendering templates based on the existing HAML views and using the same CSS assets from `public/stylesheets` and `public/css`.
- Create a small JS class library to represent UI components and application models (accounts, repositories, queries, invitations, imports), plus a persistence adapter that assumes an RDF-backed storage library.

## Key source references

- Layout shell: [`app/views/layouts/application.html.haml`](/Users/Shared/Development/Source/Library/org/datagraph/dydra-rails-20161201/app/views/layouts/application.html.haml) plus shared components in `app/views/layouts/components/`.
- Home page: [`app/views/application/index.html.haml`](/Users/Shared/Development/Source/Library/org/datagraph/dydra-rails-20161201/app/views/application/index.html.haml).
- Routes: [`config/routes.rb`](/Users/Shared/Development/Source/Library/org/datagraph/dydra-rails-20161201/config/routes.rb).
- CSS: `public/stylesheets/style.css`, `public/css/bootstrap*.css`, `public/css/dydra.reboot.css`, and related assets in `public/images`, `public/fonts`.

## Implementation plan

1. **Scaffold SPA structure in jsui**

- Create a minimal vanilla JS app shell with `index.html`, route table, and a simple client-side router (hash or History API) to map Rails routes to renderers.
- Add a base layout template that renders header/nav, content area, optional aside, and footer.

2. **Port shared layout components**

- Translate the header, navigation, and footer from `app/views/layouts/components/` into JS template functions, including logged-in/out link variants and the loading/wait UI.
- Implement `pageTitle` and `bodyClass` equivalents in the SPA (based on route and page metadata).

3. **Recreate all user-facing screens**

- Build renderers for each route in `config/routes.rb` that returns HTML matching the corresponding HAML view. This includes home, accounts, repositories, repository imports, queries, SPARQL browser, invitations, auth screens, and maintenance/static pages.
- Ensure each page provides its sidebar content and page title metadata so layout matches Rails behavior.

4. **Integrate CSS/assets**

- Copy required CSS files from `public/stylesheets` and `public/css` into `jsui` (plus required `public/images`, `public/fonts`, and `public/webfonts`) and adjust paths as needed.
- Wire `index.html` to include the same CSS ordering as Rails (`style.css`, jquery-ui theme, any reboot/bootstrap CSS used).

5. **Add JS class library + RDF persistence adapter**

- Create `/lib` classes for `Account`, `Repository`, `Query`, `Invitation`, etc., and UI controller/renderer classes for each screen.
- Add a `PersistenceAdapter` interface and a stub implementation that assumes an RDF storage client library (e.g., `RdfStoreAdapter`) with read/write/query hooks.

6. **Wire route-to-model flow**

- For each route renderer, fetch data via the model layer (using the RDF adapter) and render placeholders for now if data isn’t available.
- Ensure SPA navigation updates the URL and page metadata correctly.

## Notes

- The SPA will initially focus on accurate structure and layout; data-fetch stubs will call the presumed RDF persistence library, leaving integration points clearly marked.
- Logged-in/out UI toggles will be driven by a lightweight session model that consults the persistence adapter.

## Implementation Todos

- **scan-views**: Map each Rails route to its HAML template and define SPA route handlers.
- **spa-shell**: Add `index.html`, router, and layout template in `jsui`.
- **ui-components**: Port header/nav/footer and shared UI blocks to JS templates.
- **pages**: Implement page renderers for all screens and their sidebars.
- **assets**: Copy CSS and required assets into `jsui` and fix paths.
- **models-adapter**: Add model classes and RDF persistence adapter scaffolding.
