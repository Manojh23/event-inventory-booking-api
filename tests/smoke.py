"""Build first, then exercise the static web + real API + LangGraph + persistent DB."""
from datetime import date, timedelta
from uuid import uuid4
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
AGENT=Path(os.getenv("VENUEMATCH_DIR",str(ROOT.parent/"venuematch-decision-agent"))).resolve()

def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1",0))
        return s.getsockname()[1]

def request(base,path,method="GET",payload=None):
    req=Request(base+path,method=method,data=None if payload is None else json.dumps(payload).encode(),headers={"Content-Type":"application/json"})
    try:
        with urlopen(req,timeout=8) as res:
            data=res.read()
            return res.status,json.loads(data) if "application/json" in res.headers.get("Content-Type","") else data
    except HTTPError as exc:
        return exc.code,json.loads(exc.read())

def wait_ready(proc,base,path):
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
        if proc.poll() is not None:
            raise RuntimeError(proc.stderr.read().decode())
        try:
            if request(base,path)[0]==200:return
        except (URLError,TimeoutError,ConnectionResetError):
            pass
        time.sleep(.08)
    raise RuntimeError(f"Service did not start: {base}{path}")

def stop(proc):
    if proc and proc.poll() is None:
        proc.terminate()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.kill();proc.wait()

def main():
    agent_port,web_port=port(),port()
    agent_base=f"http://127.0.0.1:{agent_port}"
    web_base=f"http://127.0.0.1:{web_port}"
    with TemporaryDirectory() as folder:
        agent=subprocess.Popen([sys.executable,"-m","uvicorn","app:app","--host","127.0.0.1","--port",str(agent_port)],cwd=AGENT,env=os.environ|{"AGENT_MODE":"fixture"},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        web=None
        env=os.environ|{"PORT":str(web_port),"AGENT_URL":agent_base,"LEAD_DB":str(Path(folder)/"db")}
        def start_web():
            return subprocess.Popen(["node","lead-data-api/server.js"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            wait_ready(agent,agent_base,"/health")
            web=start_web()
            wait_ready(web,web_base,"/api/health")
            status,html=request(web_base,"/")
            assert status==200 and b"/assets/" in html,"Build the frontend before running smoke."
            status,batch=request(web_base,"/api/imports/demo","POST")
            assert (status,batch["accepted"],batch["rejected"])==(201,10,1)
            _,found=request(web_base,"/api/leads?q=Cedar")
            record=found["leads"][0]
            endpoint="/api/leads/"+record["id"]
            status,result=request(web_base,endpoint+"/qualify","POST")
            assert (status,result["route"],result["quote"])==(200,"model","Need a waterfront venue")
            assert request(web_base,endpoint+"/qualify","POST")[1]["route"]=="cache"
            assert request(web_base,endpoint,"PATCH",{"stage":"review","version":record["version"]})[0]==200
            assert request(web_base,endpoint,"PATCH",{"stage":"archived","version":record["version"]})[0]==409
            day=(date.today()+timedelta(days=1)).isoformat()
            brief={"day":day,"guests":60,"addons":["av","catering"]}
            status,review=request(web_base,endpoint+"/plan","POST",brief)
            assert status==200 and "Budget is unconfirmed." in review["blockers"] and review["options"]
            assert all(not o["hold_allowed"] for o in review["options"])
            _,beacon=request(web_base,"/api/leads?q=Beacon")
            qualified=beacon["leads"][0]
            quote_path="/api/leads/"+qualified["id"]
            status,plan=request(web_base,quote_path+"/plan","POST",brief)
            assert status==200 and "rank_quotes" in plan["path"] and plan["options"][0]["hold_allowed"]
            option=plan["options"][0]
            status,hold=request(web_base,quote_path+"/proposals","POST",{**brief,"day":option["day"],"venue_id":option["id"],"request_key":str(uuid4()),"lead_version":plan["lead_version"]})
            assert status==201 and hold["total_cents"]==option["total_cents"]
            assert request(web_base,quote_path+"/proposals/"+hold["id"],"PATCH",{"action":"approve"})[1]["status"]=="booked"
            stop(web)
            web=start_web()
            wait_ready(web,web_base,"/api/health")
            assert request(web_base,"/api/leads?q=Cedar")[1]["leads"][0]["stage"]=="review"
            assert [event["action"] for event in request(web_base,endpoint+"/audit")[1]]==["proposal_planned","stage_changed","qualified","qualified"]
            assert request(web_base,quote_path+"/proposals")[1][0]["status"]=="booked"
            print("Cross-service smoke passed: built UI, CSV import, LangGraph quotes, booking holds, approval, and restart persistence.")
        finally:
            stop(web)
            stop(agent)

if __name__=="__main__":main()
