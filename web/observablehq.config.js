// See https://observablehq.com/framework/config for documentation.
export default {
  // The app’s title; used in the sidebar and webpage titles.
  title: "Downwinding Data",

  // The pages and sections in the sidebar. If you don’t specify this option,
  // all pages will be listed in alphabetical order. Listing pages explicitly
  // lets you organize them into sections and have unlisted pages.
  // pages: [
  //   {
  //     name: "Examples",
  //     pages: [
  //       {name: "Dashboard", path: "/example-dashboard"},
  //       {name: "Report", path: "/example-report"}
  //     ]
  //   }
  // ],

  // Content to add to the head of the page, e.g. for a favicon:
  // The bare downwind.pro is the shared landing page (home.md): its home
  // redirects there, and every rider page goes to the same path on
  // dustin.downwind.pro so old links keep working. MagTag and tides stay
  // put (the MagTag fetches its card from here). Inline so it runs before
  // the page loads anything.
  head: `<link rel="icon" href="observable.png" type="image/png" sizes="32x32">
<script>(function () {
  var h = location.hostname, p = location.pathname, rest = location.search + location.hash;
  if (h !== 'downwind.pro' && h !== 'www.downwind.pro') return;
  if (p === '/' || p === '/index.html') return location.replace('/home.html' + rest);
  if (/^\\/(home|magtag|tides)\\.html$/.test(p) || !/\\.html$/.test(p)) return;
  location.replace('https://dustin.downwind.pro' + p + rest);
})();</script>`,

  // The path to the source root.
  root: "src",

  // Some additional configuration options and their defaults:
  // theme: "default", // try "light", "dark", "slate", etc.
  // header: "", // what to show in the header (HTML)
  footer: "",
  sidebar: false, // whether to show the sidebar
  // toc: true, // whether to show the table of contents
  pager: false, // whether to show previous & next links in the footer
  // output: "dist", // path to the output root for build
  // search: true, // activate search
  // linkify: true, // convert URLs in Markdown to links
  // typographer: false, // smart quotes and other typographic improvements
  preserveExtension: true, // keep .html in URLs (server has no extensionless routing)
  // preserveIndex: false, // drop /index from URLs
};
