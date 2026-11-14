// The landing page (/) and the About page: text and links, and the landing page's address box.
import "./style.css";

// The address goes to the census map in the hash (#find=...), where main.js runs the search and
// then drops it from the address. Without script the form sends it as ?find=..., which works too.
// The neighbourhood menu under the map: the map's own links, for a keyboard or a screen reader.
document.getElementById("home-nb")?.addEventListener("change", (e) => {
  if (e.target.value) location.href = e.target.value;
});
document.getElementById("home-find")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = e.target.elements.find.value.trim();
  if (q) location.href = `/census/#find=${encodeURIComponent(q)}`;
});
