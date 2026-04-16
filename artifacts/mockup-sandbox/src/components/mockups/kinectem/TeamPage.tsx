import React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus, FileText, Upload, Play, Trophy, Shield, ChevronRight } from "lucide-react";

export function TeamPage() {
  return (
    <div className="mx-auto w-full max-w-[520px] min-h-screen bg-slate-50 font-sans shadow-xl border-x border-slate-200">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 pt-8 pb-6 px-6">
        <div className="flex justify-between items-start mb-4">
          <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 font-bold px-2 py-0.5 text-xs shadow-sm uppercase tracking-wider">
            Westfield Athletic Club
          </Badge>
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none font-bold">Fall 2025</Badge>
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight mb-2">Varsity Football</h1>
        <div className="flex items-center gap-4 text-sm">
          <div className="font-bold text-slate-700 flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-md">
            <Trophy className="w-4 h-4 text-amber-500" />
            Record: <span className="text-slate-900">8-2-0</span>
          </div>
          <span className="text-slate-500 font-medium text-xs uppercase tracking-widest">HS Football</span>
        </div>

        {/* Admin Quick Actions */}
        <div className="flex gap-2 mt-6">
          <Button className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold h-10 shadow-md">
            <FileText className="w-4 h-4 mr-2" /> Post Recap
          </Button>
          <Button variant="outline" className="flex-1 border-slate-200 hover:bg-slate-50 text-slate-700 font-bold h-10 bg-white">
            <Upload className="w-4 h-4 mr-2" /> Highlight
          </Button>
          <Button variant="outline" size="icon" className="w-10 h-10 border-slate-200 text-slate-700 bg-white shrink-0">
            <UserPlus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="roster" className="w-full">
        <div className="bg-white px-6 border-b border-slate-200 pt-2 sticky top-0 z-10">
          <TabsList className="bg-transparent h-auto p-0 gap-6 w-full justify-start">
            <TabsTrigger 
              value="roster" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:shadow-none py-3 px-0 font-bold text-sm text-slate-500 hover:text-slate-900 uppercase tracking-wide transition-colors"
            >
              Roster
            </TabsTrigger>
            <TabsTrigger 
              value="content" 
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:text-blue-600 data-[state=active]:shadow-none py-3 px-0 font-bold text-sm text-slate-500 hover:text-slate-900 uppercase tracking-wide transition-colors"
            >
              Recaps & Highlights
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="roster" className="m-0 focus-visible:outline-none">
          <div className="px-6 py-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="hover:bg-slate-50 border-slate-200">
                    <TableHead className="w-12 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">#</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500 uppercase tracking-wider">Player</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Pos</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500 uppercase tracking-wider text-right pr-4">Grad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { num: "4", name: "Elijah Carter", pos: "QB", grad: "2026" },
                    { num: "8", name: "Jordan Smith", pos: "RB", grad: "2025" },
                    { num: "12", name: "Marcus Rivera", pos: "WR", grad: "2026" },
                    { num: "24", name: "Darnell Hayes", pos: "DB", grad: "2025" },
                    { num: "45", name: "Lucas Chen", pos: "LB", grad: "2027" },
                    { num: "52", name: "Sam Johnson", pos: "OL", grad: "2025" },
                    { num: "99", name: "Tariq Williams", pos: "DL", grad: "2026" },
                  ].map((player) => (
                    <TableRow key={player.num} className="hover:bg-slate-50 border-slate-100 cursor-pointer">
                      <TableCell className="text-center font-bold text-slate-400">{player.num}</TableCell>
                      <TableCell className="font-medium text-slate-900 py-3 flex items-center gap-3">
                        <Avatar className="w-8 h-8 rounded-md bg-slate-100">
                          <AvatarFallback className="text-[10px] font-bold text-slate-500 rounded-md">
                            {player.name.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        {player.name}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 font-bold px-1.5 py-0 text-[10px]">{player.pos}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-500 pr-4">{player.grad}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <h3 className="text-sm font-black text-slate-900 tracking-tight uppercase mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-400" /> Coaching Staff
            </h3>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 border border-slate-200">
                  <AvatarFallback className="bg-slate-100 text-slate-700 font-bold">TB</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-bold text-slate-900 leading-none">Coach Tom Bradley</p>
                  <p className="text-xs text-blue-600 font-bold uppercase tracking-wider mt-1">Head Coach</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 border border-slate-200">
                  <AvatarFallback className="bg-slate-100 text-slate-700 font-bold">MD</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-bold text-slate-900 leading-none">Coach Mike Davis</p>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Offensive Coordinator</p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="content" className="m-0 focus-visible:outline-none">
          <div className="px-6 py-6 space-y-8">
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-slate-900 tracking-tight">Recent Recaps</h3>
              </div>
              <div className="space-y-3">
                <Card className="border-slate-200 shadow-sm rounded-xl bg-white hover:border-blue-300 transition-colors cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <span>vs. Lincoln HS</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>Oct 14</span>
                      </div>
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none font-black px-2 py-0.5 text-xs shadow-sm">W 34-14</Badge>
                    </div>
                    <h4 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors mt-2 text-lg leading-tight">Offensive Explosion Leads to Big Win on Friday Night</h4>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 shadow-sm rounded-xl bg-white hover:border-blue-300 transition-colors cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <span>at Central Catholic</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>Oct 07</span>
                      </div>
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none font-black px-2 py-0.5 text-xs shadow-sm">W 21-17</Badge>
                    </div>
                    <h4 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors mt-2 text-lg leading-tight">Defense Stands Tall in Fourth Quarter to Secure Road Victory</h4>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-black text-slate-900 tracking-tight">Team Highlights</h3>
                <Button variant="ghost" size="sm" className="text-blue-600 font-bold p-0 h-auto hover:bg-transparent hover:text-blue-700">
                  View All <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Card className="overflow-hidden border border-slate-200 shadow-sm rounded-xl bg-white group cursor-pointer">
                  <div className="h-28 bg-slate-900 relative flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-blue-600 transition-colors duration-300">
                      <Play className="w-4 h-4 text-white ml-1" fill="currentColor" />
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <h4 className="font-bold text-xs text-slate-900 line-clamp-2 leading-snug">Elijah Carter 60-yd Bomb to Rivera</h4>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">#4 Carter</span>
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">#12 Rivera</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden border border-slate-200 shadow-sm rounded-xl bg-white group cursor-pointer">
                  <div className="h-28 bg-slate-800 relative flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-blue-600 transition-colors duration-300">
                      <Play className="w-4 h-4 text-white ml-1" fill="currentColor" />
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <h4 className="font-bold text-xs text-slate-900 line-clamp-2 leading-snug">Goal Line Stand vs Central</h4>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">#45 Chen</span>
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">#99 Williams</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
