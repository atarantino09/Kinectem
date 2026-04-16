import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Heart, MessageCircle, Share2, Bell, Home, Users, Trophy, User, MoreHorizontal, ShieldCheck } from "lucide-react";

export function AthleteFeed() {
  return (
    <div className="mx-auto w-full max-w-[520px] min-h-screen bg-slate-100 font-sans shadow-xl border-x border-slate-200 flex flex-col relative pb-[72px]">
      {/* Top Nav */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-20 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9 border border-slate-200 cursor-pointer">
            <AvatarFallback className="bg-slate-900 text-white font-bold text-sm">MR</AvatarFallback>
          </Avatar>
          <div className="leading-none">
            <h2 className="font-black text-slate-900 tracking-tight">Kinectem</h2>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mt-0.5">Athlete Feed</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-full relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </Button>
      </div>

      {/* Feed Content */}
      <div className="flex-1 space-y-3 p-3">
        
        {/* Post Type 1: Game Recap from Org */}
        <Card className="border-none shadow-sm rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center text-blue-400 font-black text-sm tracking-tighter shrink-0">WAC</div>
              <div>
                <p className="font-bold text-slate-900 text-sm leading-tight flex items-center gap-1">
                  Westfield Athletic Club <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                </p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">2 hours ago</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 -mr-2"><MoreHorizontal className="w-4 h-4" /></Button>
          </div>
          <CardContent className="p-0">
            <div className="p-4 pb-2">
              <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-none px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest mb-2">Game Recap</Badge>
              <h3 className="font-black text-slate-900 text-lg leading-tight mb-2">Varsity Football Rolls Over Lincoln HS in Dominant 34-14 Victory</h3>
              <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                It was a picture-perfect Friday night under the lights as Westfield took control early and never looked back. The offense was firing on all cylinders with explosive plays in the passing game and a bruising rushing attack...
              </p>
            </div>
            <div className="px-4 py-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-xs font-bold py-1 shadow-sm cursor-pointer hover:border-slate-300">@Marcus Rivera</Badge>
              <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-xs font-bold py-1 shadow-sm cursor-pointer hover:border-slate-300">@Elijah Carter</Badge>
            </div>
            <div className="p-4 pt-2">
              <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-10">Read Full Recap</Button>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-slate-500">
              <div className="flex gap-4">
                <button className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-900 transition-colors group">
                  <Heart className="w-4 h-4 group-hover:fill-slate-900" /> 124
                </button>
                <button className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-900 transition-colors">
                  <MessageCircle className="w-4 h-4" /> 18
                </button>
              </div>
              <button className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-900 transition-colors">
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Post Type 2: Highlight Clip */}
        <Card className="border-none shadow-sm rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10 border border-slate-200 shrink-0">
                <AvatarFallback className="bg-slate-100 text-slate-700 font-bold text-xs">DH</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-bold text-slate-900 text-sm leading-tight">Darnell Hayes</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">5 hours ago • DB, Westfield HS</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 -mr-2"><MoreHorizontal className="w-4 h-4" /></Button>
          </div>
          <CardContent className="p-0">
            <div className="px-4 pb-3">
              <p className="text-sm font-medium text-slate-800">Check out this interception from the 4th quarter! Reading the QB's eyes.</p>
            </div>
            <div className="h-64 bg-slate-900 relative flex items-center justify-center cursor-pointer group">
              <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm z-10">0:24</div>
              <div className="absolute bottom-3 left-3 z-10 flex gap-2">
                <Badge className="bg-blue-600 text-white border-none font-bold shadow-md">Highlight</Badge>
              </div>
              <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-blue-600 transition-colors duration-300 relative z-10">
                <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-slate-500">
              <div className="flex gap-4">
                <button className="flex items-center gap-1.5 text-xs font-bold text-blue-600 transition-colors">
                  <Heart className="w-4 h-4 fill-blue-600" /> 89
                </button>
                <button className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-900 transition-colors">
                  <MessageCircle className="w-4 h-4" /> 5
                </button>
              </div>
              <button className="flex items-center gap-1.5 text-xs font-bold hover:text-slate-900 transition-colors">
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Post Type 3: Milestone/Tag */}
        <Card className="border-none shadow-sm rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-1">
              <Trophy className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800 leading-snug">
                <span className="font-bold text-slate-900">Jordan Smith</span> was featured in a new highlight: <span className="font-bold text-blue-600 cursor-pointer">50-yd Breakaway Run</span>
              </p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Yesterday</p>
              <div className="mt-3 bg-slate-50 border border-slate-100 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:border-slate-300 transition-colors">
                <div className="w-12 h-12 bg-slate-800 rounded-md flex items-center justify-center shrink-0">
                  <Play className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">50-yd Breakaway Run</p>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Westfield Varsity Football</p>
                </div>
              </div>
            </div>
          </div>
        </Card>
        
        {/* Spacer for bottom nav */}
        <div className="h-4"></div>
      </div>

      {/* Bottom Nav Bar */}
      <div className="bg-white border-t border-slate-200 fixed bottom-0 w-full max-w-[520px] pb-safe z-30">
        <div className="flex justify-between items-center px-6 py-3">
          <button className="flex flex-col items-center gap-1 text-blue-600">
            <Home className="w-6 h-6" strokeWidth={2.5} />
            <span className="text-[9px] font-bold">Home</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-900 transition-colors">
            <Trophy className="w-6 h-6" strokeWidth={2} />
            <span className="text-[9px] font-bold">Teams</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-900 transition-colors relative">
            <div className="absolute -top-3 w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center text-white shadow-lg shadow-slate-900/20 border-4 border-white">
              <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
            </div>
            <span className="text-[9px] font-bold mt-7">Post</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-900 transition-colors">
            <Users className="w-6 h-6" strokeWidth={2} />
            <span className="text-[9px] font-bold">Orgs</span>
          </button>
          <button className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-900 transition-colors">
            <User className="w-6 h-6" strokeWidth={2} />
            <span className="text-[9px] font-bold">Profile</span>
          </button>
        </div>
      </div>
    </div>
  );
}
