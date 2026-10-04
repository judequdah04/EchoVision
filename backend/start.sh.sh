#!/bin/bash
echo "=== EchoVision Startup ==="
cd /workspace/echovision

echo "Installing dependencies..."
pip install -q fastapi==0.111.0 uvicorn[standard]==0.29.0 python-multipart==0.0.9 websockets==12.0 httpx==0.27.0 pillow==10.3.0 numpy==1.26.4 opencv-python-headless==4.9.0.80 scipy==1.13.0 ultralytics==8.2.0 torchvision==0.19.0 timm==0.9.16 groq==0.9.0 elevenlabs==1.2.0 pinecone==4.1.0 firebase-admin==6.5.0 gdown==5.2.0
pip uninstall -y onnxruntime onnxruntime-gpu 2>/dev/null
pip install -q onnxruntime-gpu==1.18.0 --no-deps
pip install -q coloredlogs flatbuffers protobuf sympy insightface==0.7.3
apt-get install -y -q ffmpeg libgl1-mesa-glx libglib2.0-0 unzip 2>/dev/null

cp /workspace/echovision/models/ffmpeg /usr/local/bin/ffmpeg 2>/dev/null
chmod +x /usr/local/bin/ffmpeg
echo "ffmpeg restored"
echo "Starting EchoVision server..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 2>&1 | tee logs/server.logcp /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg 2>/dev/null; export PATH=$PATH:/usr/local/bin
#!/bin/bash
cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg /usr/local/bin/ 2>/dev/null || true
cp /tmp/ffmpeg-master-latest-linux64-gpl/bin/ffprobe /usr/local/bin/ 2>/dev/null || true
