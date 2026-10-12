import Current from "./components/mockups/kinectem-feed/Current";
import GameDay from "./components/mockups/kinectem-feed/GameDay";
import AchievementRefresh from "./components/mockups/kinectem-achievements/Refresh";

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/kinectem-achievements/Refresh")) return <AchievementRefresh />;
  const routes = { Current, GameDay };
  const routeName = pathname.endsWith("/GameDay") ? "GameDay" : "Current";
  const Preview = routes[routeName];
  return <Preview />;
}