"""Small stdlib client; reads the key from disk and never prints it."""
import argparse
import json
import mimetypes
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


class Client:
    def __init__(self, url, key_file):
        self.url=url.rstrip('/');self.key=Path(key_file).read_text().strip()

    def request(self, path, method='GET', payload=None, content_type='application/json'):
        if not path.startswith('/v1/'):
            raise ValueError('Only relative API paths are allowed')
        body=json.dumps(payload).encode() if payload is not None and content_type=='application/json' else payload
        headers={'Authorization':'Bearer '+self.key}
        if body is not None:headers['Content-Type']=content_type
        req=urllib.request.Request(self.url+path,data=body,method=method,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=60) as r:return r.read(),r.headers.get_content_type()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'API error {e.code}: {e.read().decode()}') from None

    def json(self,path,method='GET',payload=None):
        return json.loads(self.request(path,method,payload)[0])

    def wait(self, job_id, timeout=21600):
        deadline=time.monotonic()+timeout;previous=None
        while time.monotonic()<deadline:
            job=self.json('/v1/jobs/'+job_id)
            state=(job['status'],job['phase'],job['progress']['completed'],job['progress']['total'])
            if state!=previous:
                print(json.dumps(dict(job_id=job_id,status=state[0],phase=state[1],completed=state[2],total=state[3])),file=sys.stderr,flush=True);previous=state
            if job['status']=='succeeded':return self.json('/v1/jobs/'+job_id+'/result')
            if job['status'] in ['failed','cancelled','expired']:raise RuntimeError(json.dumps(job))
            time.sleep(3)
        raise TimeoutError('Client wait limit exceeded; the server job is still available by ID')

    def create_voice(self,name,audio,settings=None):
        boundary=uuid.uuid4().hex;parts=[]
        for key,value in [('name',name),('voice_settings',json.dumps(settings or {}))]:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        path=Path(audio);media=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="reference"\r\nContent-Type: {media}\r\n\r\n'.encode()+path.read_bytes()+b'\r\n')
        parts.append(f'--{boundary}--\r\n'.encode())
        return json.loads(self.request('/v1/voices','POST',b''.join(parts),'multipart/form-data; boundary='+boundary)[0])

    def download(self,result,destination):
        target=Path(destination);target.mkdir(parents=True,exist_ok=True)
        allowed={'audio.opus','audio.wav','alignment.json','words.json','subtitles.srt','metadata.json'}
        for name,path in result['artifacts'].items():
            if name not in allowed or not path.startswith('/v1/jobs/'+result['job_id']+'/artifacts/'):
                raise ValueError('Unexpected artifact name or path')
            (target/name).write_bytes(self.request(path)[0])
        return dict(job_id=result['job_id'],downloaded_to=str(target.resolve()))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8080');p.add_argument('--key-file',default='.secrets/api_key');sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('voices')
    c=sub.add_parser('voice-create');c.add_argument('--name',required=True);c.add_argument('--audio',required=True);c.add_argument('--wait',action='store_true')
    n=sub.add_parser('narrate');n.add_argument('--voice-id',required=True);n.add_argument('--text-file',required=True);n.add_argument('--speed',type=float,default=1.08);n.add_argument('--wait',action='store_true');n.add_argument('--output')
    w=sub.add_parser('wait');w.add_argument('job_id');w.add_argument('--output')
    a=p.parse_args();client=Client(a.url,a.key_file)
    if a.command=='voices':result=client.json('/v1/voices')
    elif a.command=='voice-create':
        result=client.create_voice(a.name,a.audio)
        if a.wait:result=client.wait(result['job_id'])
    elif a.command=='narrate':
        result=client.json('/v1/text-to-speech/'+a.voice_id,'POST',dict(text=Path(a.text_file).read_text(),voice_settings=dict(speed=a.speed)))
        if a.wait:result=client.wait(result['job_id'])
        if a.output:
            if 'artifacts' not in result:raise ValueError('--output requires --wait')
            result=client.download(result,a.output)
    else:
        result=client.wait(a.job_id)
        if a.output:result=client.download(result,a.output)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
