import "./_group.css";
import { AchievementsPanel } from "./_updated/AchievementsPanel";
import { ContributorsSection } from "./_updated/ContributorsSection";
import { DemoProvider } from "./_mock-hooks";

export default function Refresh() {
  return <DemoProvider>
    <main className="min-h-screen px-4 py-6 sm:p-7">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Kinectem · Design preview</p>
          <h1 className="mt-1 text-2xl font-black">Community achievements</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sample data. Open each collection to see tiers and progress.</p>
        </div>
        <AchievementsPanel subject="team" id="team" title="Team achievements" />
        <AchievementsPanel subject="organization" id="organization" title="Organization achievements" />
        <AchievementsPanel subject="user" id="user" title="Coach & contributor achievements" />
        <ContributorsSection orgId="organization" />
      </div>
    </main>
  </DemoProvider>;
}
