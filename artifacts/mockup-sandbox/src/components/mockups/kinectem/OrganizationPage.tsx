import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Plus, Upload, FileText, ChevronRight, Play } from "lucide-react";

export function OrganizationPage() {
  return (
    <div className="mx-auto w-full max-w-[520px] min-h-screen bg-slate-50 font-sans shadow-xl border-x border-slate-200">
      {/* Header Banner */}
      <div className="h-40 bg-gradient-to-tr from-slate-900 via-blue-900 to-slate-800 relative px-6 py-6 flex flex-col justify-end">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/10 to-transparent opacity-30 mix-blend-overlay"></div>
        <div className="flex items-end justify-between relative z-10">
          <div className="flex items-end gap-4">
            <div className="w-20 h-20 bg-white rounded-xl shadow-lg border-4 border-white flex items-center justify-center -mb-8 overflow-hidden relative">
              <div className="text-3xl font-black text-blue-600 tracking-tighter">WAC</div>
            </div>
            <div className="text-white pb-1">
              <h1 className="text-2xl font-black tracking-tight leading-none mb-1">Westfield Athletic Club</h1>
              <div className="flex items-center gap-2 text-blue-100 text-xs font-medium">
                <MapPin className="w-3 h-3" /> Westfield, NJ
                <span className="opacity-50">•</span>
                <span className="font-bold text-white tracking-wide">1.2K FOLLOWERS</span>
              </div>
            </div>
          </div>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-full px-5 shadow-blue-600/20 shadow-lg -mb-2">
            Follow
          </Button>
        </div>
      </div>

      <div className="px-6 pt-12 pb-6 space-y-8">
        {/* About */}
        <section>
          <p className="text-sm text-slate-600 leading-relaxed">
            Premier youth sports organization dedicated to developing student-athletes in Union County. 
            Home of the Blue Devils. Developing talent, character, and leadership since 1995.
          </p>
          <div className="flex gap-2 mt-3">
            <Badge variant="secondary" className="bg-slate-200/50 text-slate-700 border-none font-semibold">Football</Badge>
            <Badge variant="secondary" className="bg-slate-200/50 text-slate-700 border-none font-semibold">Basketball</Badge>
            <Badge variant="secondary" className="bg-slate-200/50 text-slate-700 border-none font-semibold">Lacrosse</Badge>
          </div>
        </section>

        {/* Admin Actions */}
        <section className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex gap-2 overflow-x-auto no-scrollbar">
          <Button variant="outline" className="flex-1 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold bg-white shrink-0 min-w-[140px]">
            <Plus className="w-4 h-4 mr-2 text-blue-600" /> Create Team
          </Button>
          <Button variant="outline" className="flex-1 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold bg-white shrink-0 min-w-[140px]">
            <FileText className="w-4 h-4 mr-2 text-blue-600" /> Post Recap
          </Button>
          <Button variant="outline" className="flex-1 border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold bg-white shrink-0 min-w-[140px]">
            <Upload className="w-4 h-4 mr-2 text-blue-600" /> Upload Highlight
          </Button>
        </section>

        {/* Teams */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-900 tracking-tight">Active Teams</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="border border-slate-200 shadow-sm rounded-xl hover:border-blue-300 transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Fall 2025</Badge>
                  <span className="text-xs font-bold text-slate-400">8-2</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">Varsity Football</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Users className="w-3.5 h-3.5" /> 45 Players
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 font-bold hover:bg-blue-50 -mr-2">
                    View <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-sm rounded-xl hover:border-blue-300 transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Fall 2025</Badge>
                  <span className="text-xs font-bold text-slate-400">6-3</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">JV Football</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Users className="w-3.5 h-3.5" /> 38 Players
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 font-bold hover:bg-blue-50 -mr-2">
                    View <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-sm rounded-xl hover:border-blue-300 transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-none text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Winter 2025</Badge>
                  <span className="text-xs font-bold text-slate-400">0-0</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">Varsity Boys Basketball</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Users className="w-3.5 h-3.5" /> 15 Players
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-blue-600 font-bold hover:bg-blue-50 -mr-2">
                    View <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Recent Activity */}
        <section>
          <h2 className="text-xl font-black text-slate-900 tracking-tight mb-4">Recent Activity</h2>
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 pb-4 border-b border-slate-200">
                <p className="text-sm font-medium text-slate-900">
                  <span className="font-bold">Westfield Athletic Club</span> posted a new Game Recap: <span className="font-bold text-blue-600">Varsity Rolls Over Lincoln 34-14</span>
                </p>
                <span className="text-xs text-slate-500 font-medium mt-1 block">2 hours ago</span>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center shrink-0">
                <Play className="w-5 h-5 text-white ml-0.5" fill="currentColor" />
              </div>
              <div className="flex-1 pb-4 border-b border-slate-200">
                <p className="text-sm font-medium text-slate-900">
                  <span className="font-bold">Westfield Athletic Club</span> uploaded a highlight from <span className="font-bold text-blue-600">JV Football</span>
                </p>
                <div className="mt-2 h-20 w-32 bg-slate-800 rounded-lg relative overflow-hidden flex items-center justify-center">
                  <Play className="w-6 h-6 text-white/50" />
                </div>
                <span className="text-xs text-slate-500 font-medium mt-2 block">1 day ago</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
