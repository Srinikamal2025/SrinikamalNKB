// FINAL server.js — no JWT, no auth, fully open API
const fs=require("fs");
const path=require("path");
const express=require("express");
const http=require("http");
const cors=require("cors");
const {Server}=require("socket.io");

const app=express();
const server=http.createServer(app);
const io=new Server(server);

const DATA_FILE=path.join(__dirname,"data.json");

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function readData(){
  try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}
  catch(e){
    return{rooms:[],payments:{cash:0,upi:0,dayRevenue:0,monthRevenue:0},customers:[],notifications:[]};
  }
}
function writeData(d){fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2));}

app.get("/api/rooms",(req,res)=>{
  const d=readData();res.json(d.rooms||[]);
});
app.post("/api/rooms",(req,res)=>{
  const d=readData();d.rooms=req.body;writeData(d);
  io.emit("roomsUpdated",d.rooms);res.json({ok:true});
});

app.get("/api/payments",(req,res)=>{
  const d=readData();res.json(d.payments||{});
});
app.post("/api/payments",(req,res)=>{
  const d=readData();const p=d.payments;const b=req.body;
  if("cash" in b)p.cash=b.cash;
  if("upi" in b)p.upi=b.upi;
  if("dayRevenue" in b)p.dayRevenue=b.dayRevenue;
  if("monthRevenue" in b)p.monthRevenue=b.monthRevenue;
  if(b.amount&&b.mode){
    const amt=Number(b.amount)||0;
    if(b.mode==="upi")p.upi+=amt; else p.cash+=amt;
    p.dayRevenue+=amt; p.monthRevenue+=amt;
  }
  p.lastUpdated=new Date().toISOString();
  writeData(d);
  io.emit("paymentsUpdated",p);
  res.json({ok:true,payments:p});
});

app.get("/api/customers",(req,res)=>{
  const d=readData();res.json(d.customers||[]);
});
app.post("/api/customers",(req,res)=>{
  const d=readData();const c=req.body;
  if(!d.customers)d.customers=[];
  if(c.aadhar){
    let ex=d.customers.find(x=>x.aadhar===c.aadhar);
    if(ex)Object.assign(ex,c);
    else d.customers.push(c);
  } else d.customers.push(c);
  writeData(d);
  io.emit("customersUpdated",d.customers);
  res.json({ok:true,customers:d.customers});
});

app.get("/api/notifications",(req,res)=>{
  const d=readData();res.json(d.notifications||[]);
});
app.post("/api/notifications",(req,res)=>{
  const d=readData();
  d.notifications.push({id:Date.now().toString(),message:req.body.message||"",timestamp:new Date().toISOString()});
  writeData(d);
  io.emit("notificationsUpdated",d.notifications);
  res.json({ok:true});
});

io.on("connection",s=>{
  const d=readData();
  s.emit("roomsUpdated",d.rooms||[]);
  s.emit("paymentsUpdated",d.payments||{});
  s.emit("customersUpdated",d.customers||[]);
  s.emit("notificationsUpdated",d.notifications||[]);
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Server running on",PORT));
