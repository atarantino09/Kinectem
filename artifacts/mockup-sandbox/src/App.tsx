import Current from "./components/mockups/kinectem-feed/Current";
import GameDay from "./components/mockups/kinectem-feed/GameDay";

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const routes = { Current, GameDay };
  const routeName = pathname.endsWith("/GameDay") ? "GameDay" : "Current";
  const Preview = routes[routeName];
  return <Preview />;
}