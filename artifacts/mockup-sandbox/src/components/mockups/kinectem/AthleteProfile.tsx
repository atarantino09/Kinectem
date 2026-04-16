import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Play, MapPin, UserPlus, MessageSquare, ChevronRight } from "lucide-react";

export function AthleteProfile() {
  return (
    <div className="mx-auto w-full max-w-[430px] min-h-screen bg-slate-50 font-sans shadow-xl overflow-hidden relative border-x border-slate-200">
      {/* Header Banner */}
      <div className="h-32 bg-gradient-to-r from-slate-900 to-blue-900 relative">
        <div className="absolute top-4 right-4 flex gap-2">
          <Button size="icon" variant="secondary" className="rounded-full bg-white/20 text-white hover:bg-white/30 border-none backdrop-blur-md">
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="secondary" className="rounded-full bg-white/20 text-white hover:bg-white/30 border-none backdrop-blur-md">
            <UserPlus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Profile Info */}
      <div className="px-5 pb-5 relative -mt-12 bg-white rounded-t-3xl pt-14 shadow-sm z-10">
        <Avatar className="w-24 h-24 border-4 border-white absolute -top-12 left-5 shadow-sm">
          <AvatarFallback className="bg-slate-100 text-slate-800 text-3xl font-bold">MR</AvatarFallback>
        </Avatar>
        
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Marcus Rivera</h1>
            <p className="text-blue-600 font-bold text-sm tracking-wide mt-0.5">#12 • WIDE RECEIVER</p>
            <div className="flex items-center gap-1.5 text-slate-500 text-sm mt-1.5 font-medium">
              <MapPin className="w-3.5 h-3.5" />
              Westfield High School, NJ
            </div>
            <div className="flex items-center gap-2 mt-2.5">
              <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-none rounded-md px-2">Class of 2026</Badge>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-none rounded-md px-2">16 yrs old</Badge>
            </div>
          </div>
        </div>

        <p className="mt-5 text-sm text-slate-600 leading-relaxed">
          Speed, hands, and vision. Dedicated to outworking the competition. 
          Looking to play at the next level. 4.45 40-yd dash.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mt-6 py-4 border-y border-slate-100">
          <div className="text-center">
            <div className="text-2xl font-black text-slate-900">12</div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1">Games</div>
          </div>
          <div className="text-center border-l border-slate-100">
            <div className="text-2xl font-black text-blue-600">850</div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1">Rec Yds</div>
          </div>
          <div className="text-center border-l border-slate-100">
            <div className="text-2xl font-black text-slate-900">14</div>
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1">TDs</div>
          </div>
        </div>
      </div>

      <div className="px-5 py-6 space-y-8 bg-slate-50">
        {/* Highlights */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-black text-slate-900 tracking-tight">Highlights</h2>
            <Button variant="ghost" size="sm" className="text-blue-600 font-semibold p-0 h-auto hover:bg-transparent hover:text-blue-700">
              View All <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
          
          <ScrollArea className="w-full whitespace-nowrap pb-4 -mx-5 px-5">
            <div className="flex w-max space-x-4">
              <Card className="w-[260px] overflow-hidden border-none shadow-sm rounded-xl bg-white shrink-0">
                <div className="h-36 bg-gradient-to-tr from-slate-900 to-slate-800 relative flex items-center justify-center group cursor-pointer">
                  <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-blue-600 transition-colors duration-300">
                    <Play className="w-5 h-5 text-white ml-1" fill="currentColor" />
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-1.5 py-0.5 rounded">0:45</div>
                </div>
                <CardContent className="p-3">
                  <h3 className="font-bold text-sm text-slate-900 truncate">40-yard TD Catch vs. Lincoln HS</h3>
                  <p className="text-xs text-slate-500 mt-1">Oct 14, 2025</p>
                  <div className="flex gap-1.5 mt-2.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-600 font-medium bg-slate-50">Marcus Rivera</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="w-[260px] overflow-hidden border-none shadow-sm rounded-xl bg-white shrink-0">
                <div className="h-36 bg-gradient-to-tr from-blue-900 to-slate-900 relative flex items-center justify-center group cursor-pointer">
                  <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-blue-600 transition-colors duration-300">
                    <Play className="w-5 h-5 text-white ml-1" fill="currentColor" />
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-1.5 py-0.5 rounded">1:12</div>
                </div>
                <CardContent className="p-3">
                  <h3 className="font-bold text-sm text-slate-900 truncate">One-Handed Grab in Double Coverage</h3>
                  <p className="text-xs text-slate-500 mt-1">Oct 07, 2025</p>
                  <div className="flex gap-1.5 mt-2.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-600 font-medium bg-slate-50">Marcus Rivera</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
            <ScrollBar orientation="horizontal" className="hidden" />
          </ScrollArea>
        </section>

        {/* Game Recaps */}
        <section>
          <h2 className="text-lg font-black text-slate-900 tracking-tight mb-4">Articles & Recaps</h2>
          <div className="space-y-3">
            <Card className="border-none shadow-sm rounded-xl bg-white">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Game Recap</Badge>
                  <span className="text-xs text-slate-400 font-medium">Oct 15, 2025</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-1.5">Westfield Dominates Lincoln High 34-14</h3>
                <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">
                  Marcus Rivera put on a clinic with 3 touchdowns and over 150 receiving yards. The offense was clicking on all cylinders as they roll to their 8th win of the season.
                </p>
                <div className="mt-3 flex gap-2">
                  <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-200 border-none font-medium text-[10px]">Westfield Varsity Football</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm rounded-xl bg-white">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Player Spotlight</Badge>
                  <span className="text-xs text-slate-400 font-medium">Sep 28, 2025</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-1.5">Mid-Season Breakout Stars to Watch</h3>
                <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">
                  Several local players are making big waves midway through the fall season. Wide receiver Marcus Rivera has emerged as a premier deep threat.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Teams */}
        <section>
          <h2 className="text-lg font-black text-slate-900 tracking-tight mb-4">Teams</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="px-3 py-1.5 border-slate-200 bg-white text-slate-700 font-semibold shadow-sm flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-600"></div>
              Westfield Varsity Football
            </Badge>
            <Badge variant="outline" className="px-3 py-1.5 border-slate-200 bg-white text-slate-700 font-semibold shadow-sm flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-amber-500"></div>
              NJ Elite 7v7 (Spring 2025)
            </Badge>
            <Badge variant="outline" className="px-3 py-1.5 border-slate-200 bg-white text-slate-700 font-semibold shadow-sm flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-slate-300"></div>
              Westfield JV Football (2024)
            </Badge>
          </div>
        </section>
      </div>
    </div>
  );
}
