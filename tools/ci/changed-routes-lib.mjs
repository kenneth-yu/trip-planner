const PARAMS = {
  tripId: "00000000-0000-4000-8300-000000000001",
  itemId: "00000000-0000-4000-8400-000000000005",
};

export function routeOfPage(pagePath) {
  const route = pagePath.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "");
  return route === "" ? "/" : route;
}

export function concreteRoute(route) {
  let unknown = false;
  const concrete = route.replace(/\[([A-Za-z]+)\]/g, (_match, name) => {
    if (name in PARAMS) return PARAMS[name];
    unknown = true;
    return "";
  });
  return unknown ? null : concrete;
}

function directoryOf(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function routesTouched(changedFiles, pages) {
  const touched = new Set();
  for (const file of changedFiles) {
    if (!file.startsWith("src/app/")) continue;
    const directory = directoryOf(file);
    for (const page of pages) {
      const pageDirectory = directoryOf(page);
      if (pageDirectory === directory || pageDirectory.startsWith(`${directory}/`)) touched.add(page);
    }
  }
  return [...touched];
}

export function concreteRoutes(pages) {
  return pages
    .map((page) => concreteRoute(routeOfPage(page)))
    .filter((route) => route !== null)
    .sort();
}

const IGNORED = [/^docs\//, /^e2e\//, /^\.pipeline\//, /\.md$/];

export function selectPages(changedFiles, pages) {
  const relevant = changedFiles.filter((file) => !IGNORED.some((pattern) => pattern.test(file)));
  const outside = relevant.find((file) => !file.startsWith("src/app/"));
  if (outside) return { pages, reason: `${outside} is outside src/app, so any page may be affected` };
  const touched = routesTouched(relevant, pages);
  const unfillable = touched.find((page) => concreteRoute(routeOfPage(page)) === null);
  if (unfillable) return { pages, reason: `${unfillable} has a parameter the checker cannot fill in` };
  return { pages: touched, reason: null };
}
