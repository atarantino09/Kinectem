import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Upload, Play, X, Bold, Italic, Link as LinkIcon, Image as ImageIcon, Check } from "lucide-react";

export function GameRecapCreator() {
  return (
    <div className="mx-auto w-full max-w-[600px] min-h-screen bg-slate-50 font-sans shadow-xl border-x border-slate-200 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-20 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">New Game Recap</h1>
          <p className="text-xs text-slate-500 font-medium">Westfield Varsity Football</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="text-slate-600 font-bold hover:bg-slate-100 h-9">Cancel</Button>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-9 shadow-md shadow-blue-600/20 px-6">Publish</Button>
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* Core Info */}
        <section className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs font-black text-slate-800 uppercase tracking-widest">Select Game</Label>
            <Select defaultValue="game1">
              <SelectTrigger className="w-full bg-white border-slate-200 h-12 font-medium text-slate-900 focus:ring-blue-600 shadow-sm rounded-lg">
                <SelectValue placeholder="Select a game" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="game1" className="font-medium">Westfield vs. Lincoln HS — Oct 14, 2025</SelectItem>
                <SelectItem value="game2" className="font-medium">Westfield at Central Catholic — Oct 07, 2025</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black text-slate-800 uppercase tracking-widest">Article Title</Label>
            <Input 
              placeholder="e.g. Dominant Victory on Friday Night..." 
              className="w-full bg-white border-slate-200 h-12 font-bold text-lg text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus-visible:ring-blue-600 shadow-sm rounded-lg"
              defaultValue="Offensive Explosion Leads to Big Win"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-black text-slate-800 uppercase tracking-widest">Article Body</Label>
            <div className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm focus-within:ring-1 focus-within:ring-blue-600 transition-shadow">
              <div className="flex items-center gap-1 border-b border-slate-100 p-2 bg-slate-50/50">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-white hover:text-slate-900 rounded"><Bold className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-white hover:text-slate-900 rounded"><Italic className="w-4 h-4" /></Button>
                <div className="w-px h-4 bg-slate-200 mx-1"></div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-white hover:text-slate-900 rounded"><LinkIcon className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600 hover:bg-white hover:text-slate-900 rounded"><ImageIcon className="w-4 h-4" /></Button>
              </div>
              <Textarea 
                className="w-full min-h-[200px] p-4 border-0 focus-visible:ring-0 resize-none font-medium text-slate-700 leading-relaxed text-base"
                placeholder="Write the recap here..."
                defaultValue="It was a picture-perfect Friday night under the lights as Westfield took control early and never looked back, securing a decisive 34-14 victory over Lincoln High..."
              />
            </div>
          </div>
        </section>

        <div className="h-px bg-slate-200 w-full"></div>

        {/* Highlights */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-black text-slate-800 uppercase tracking-widest">Attach Highlights</Label>
            <span className="text-xs font-bold text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded">2 Uploaded</span>
          </div>

          <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 bg-slate-50 hover:bg-slate-100/50 transition-colors flex flex-col items-center justify-center text-center cursor-pointer mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
              <Upload className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-sm font-bold text-slate-700 mb-1">Click or drag videos here</p>
            <p className="text-xs text-slate-500 font-medium">MP4, MOV up to 50MB</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card className="overflow-hidden border border-slate-200 shadow-sm bg-white relative group">
              <Button size="icon" variant="destructive" className="absolute top-2 right-2 w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10 scale-90 hover:scale-100">
                <X className="w-3 h-3" />
              </Button>
              <div className="h-24 bg-slate-900 relative flex items-center justify-center">
                <Play className="w-6 h-6 text-white/70" fill="currentColor" />
                <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">0:15</div>
              </div>
              <div className="p-2 border-t border-slate-100">
                <Input defaultValue="Rivera 40yd TD Catch" className="h-7 text-xs font-bold px-2 border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 shadow-none" />
              </div>
            </Card>

            <Card className="overflow-hidden border border-slate-200 shadow-sm bg-white relative group">
              <Button size="icon" variant="destructive" className="absolute top-2 right-2 w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10 scale-90 hover:scale-100">
                <X className="w-3 h-3" />
              </Button>
              <div className="h-24 bg-slate-800 relative flex items-center justify-center">
                <Play className="w-6 h-6 text-white/70" fill="currentColor" />
                <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">0:24</div>
              </div>
              <div className="p-2 border-t border-slate-100">
                <Input defaultValue="Carter Scramble 3rd Down" className="h-7 text-xs font-bold px-2 border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 shadow-none" />
              </div>
            </Card>
          </div>
        </section>

        <div className="h-px bg-slate-200 w-full"></div>

        {/* Tagging */}
        <section className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs font-black text-slate-800 uppercase tracking-widest">Tag Players</Label>
            <p className="text-xs text-slate-500 font-medium mb-3">Tagged players will be notified and this recap will appear on their profile if featured.</p>
            
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1.5 shadow-sm focus-within:ring-1 focus-within:ring-blue-600 transition-shadow">
              <div className="flex flex-wrap gap-1.5 pl-1">
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 px-2 py-1 pr-1 flex items-center gap-1">
                  M. Rivera #12
                  <div className="w-4 h-4 rounded-full hover:bg-slate-300 flex items-center justify-center cursor-pointer transition-colors"><X className="w-2.5 h-2.5" /></div>
                </Badge>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 px-2 py-1 pr-1 flex items-center gap-1">
                  E. Carter #4
                  <div className="w-4 h-4 rounded-full hover:bg-slate-300 flex items-center justify-center cursor-pointer transition-colors"><X className="w-2.5 h-2.5" /></div>
                </Badge>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 font-bold hover:bg-slate-200 px-2 py-1 pr-1 flex items-center gap-1">
                  D. Hayes #24
                  <div className="w-4 h-4 rounded-full hover:bg-slate-300 flex items-center justify-center cursor-pointer transition-colors"><X className="w-2.5 h-2.5" /></div>
                </Badge>
              </div>
              <Input placeholder="Type to search roster..." className="border-0 shadow-none focus-visible:ring-0 h-8 flex-1 min-w-[120px] text-sm font-medium" />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-white border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">MR</div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Marcus Rivera</p>
                  <p className="text-xs text-slate-500 font-medium">WR • #12</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="feat-1" className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Feature on Profile</Label>
                <Switch id="feat-1" defaultChecked className="data-[state=checked]:bg-blue-600" />
              </div>
            </div>
            
            <div className="px-4 py-3 bg-white border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">EC</div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Elijah Carter</p>
                  <p className="text-xs text-slate-500 font-medium">QB • #4</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="feat-2" className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Feature on Profile</Label>
                <Switch id="feat-2" defaultChecked className="data-[state=checked]:bg-blue-600" />
              </div>
            </div>

            <div className="px-4 py-3 bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">DH</div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Darnell Hayes</p>
                  <p className="text-xs text-slate-500 font-medium">DB • #24</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="feat-3" className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Feature on Profile</Label>
                <Switch id="feat-3" className="data-[state=checked]:bg-blue-600" />
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
