import L from "leaflet";

/**
 * OpenStreetMap's tiles with what its usage policy asks of a web page (issue #281): attribution and a
 * valid Referer. The page's own policy is `same-origin` (service-kit), which sends no Referer to the
 * tile server and gets the tiles blocked; the tiles send the page's origin, nothing more.
 */
export const osmTiles = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  referrerPolicy: "strict-origin-when-cross-origin",
});
