import os,sys,json,torch
import torchvision.transforms as T
from ultralytics import YOLO
from groq import Groq
from pinecone import Pinecone,ServerlessSpec
from insightface.app import FaceAnalysis
import torch.nn as nn
from torchvision import models as tv_models
sys.path.insert(0,"/workspace/echovision")
from core.config import *
MODELS={}

def _load_reltr_labelspace():
    with open(VG_ANN_DIR+"/train.json") as f: coco=json.load(f)
    cats=sorted(coco["categories"],key=lambda x:x["id"])
    id_to_name=["N/A"]*(max(c["id"] for c in cats)+1)
    for c in cats: id_to_name[c["id"]]=c["name"]
    with open(VG_ANN_DIR+"/rel.json") as f: rel=json.load(f)
    return id_to_name,rel["rel_categories"]

def _load_reltr():
    if RELTR_REPO not in sys.path: sys.path.insert(0,RELTR_REPO)
    classes,predicates=_load_reltr_labelspace()
    transform=T.Compose([T.Resize(800),T.ToTensor(),T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
    from models import build_model
    class _Args: pass
    args=_Args()
    for k,v in dict(dataset="vg",backbone="resnet50",dilation=False,position_embedding="sine",enc_layers=6,dec_layers=6,dim_feedforward=2048,hidden_dim=256,dropout=0.1,nheads=8,num_entities=100,num_triplets=200,pre_norm=False,aux_loss=True,device=DEVICE,resume=RELTR_CKPT,lr_backbone=1e-5,set_cost_class=1,set_cost_bbox=5,set_cost_giou=2,set_iou_threshold=0.7,bbox_loss_coef=5,giou_loss_coef=2,rel_loss_coef=1,eos_coef=0.1,return_interm_layers=False).items(): setattr(args,k,v)
    model,_,_=build_model(args)
    ck=torch.load(RELTR_CKPT,map_location="cpu",weights_only=False)
    model.load_state_dict(ck["model"])
    model.to(DEVICE).eval()
    return model,classes,predicates,transform

def _build_sentiment_model():
    model=tv_models.resnet18(weights=None)
    model.fc=nn.Sequential(nn.Dropout(0.4),nn.Linear(model.fc.in_features,7))
    model.load_state_dict(torch.load(RESNET_W,map_location=DEVICE))
    model.to(DEVICE).eval()
    return model

def _get_pinecone_index():
    pc=Pinecone(api_key=PINECONE_API_KEY)
    existing=[i.name for i in pc.list_indexes()]
    if PINECONE_INDEX not in existing:
        pc.create_index(name=PINECONE_INDEX,dimension=ARC_EMBED_DIM,metric="cosine",spec=ServerlessSpec(cloud="aws",region="us-east-1"))
    return pc.Index(PINECONE_INDEX)

def load_all_models():
    global MODELS
    print("Loading YOLO...")
    # yolov8s for general object detection (better accuracy than nano)
    # downloads automatically on first run, cached after that
    coco_yolo   = YOLO("yolov8s.pt");   coco_yolo.to(DEVICE)
    custom_yolo = YOLO(CUSTOM_YOLO);    custom_yolo.to(DEVICE)
    print("Loading MiDaS...")
    midas           = torch.hub.load("intel-isl/MiDaS","MiDaS_small",trust_repo=True)
    midas_transform = torch.hub.load("intel-isl/MiDaS","transforms",trust_repo=True).small_transform
    midas.to(DEVICE).eval()
    print("Loading RelTR...")
    reltr,reltr_classes,reltr_predicates,reltr_transform=_load_reltr()
    print("Loading InsightFace...")
    face_app=FaceAnalysis(name="buffalo_l",providers=["CUDAExecutionProvider","CPUExecutionProvider"])
    face_app.prepare(ctx_id=0,det_size=(640,640))
    print("Loading sentiment...")
    sentiment=_build_sentiment_model()
    print("Connecting Pinecone...")
    pinecone_index=_get_pinecone_index()
    groq_client=Groq(api_key=GROQ_API_KEY)
    MODELS={
        "coco_yolo":        coco_yolo,
        "custom_yolo":      custom_yolo,
        "midas":            midas,
        "midas_transform":  midas_transform,
        "reltr":            reltr,
        "reltr_classes":    reltr_classes,
        "reltr_predicates": reltr_predicates,
        "reltr_transform":  reltr_transform,
        "face_app":         face_app,
        "sentiment":        sentiment,
        "pinecone":         pinecone_index,
        "groq":             groq_client,
    }
    print("All models loaded.")
    return MODELS

def warmup_models(models):
    import numpy as np
    from PIL import Image
    print("Warming up models...")
    dummy_pil = Image.new("RGB", (640, 480))
    dummy_arr = np.array(dummy_pil)
    for m in [models["coco_yolo"], models["custom_yolo"]]:
        m.predict(dummy_arr, verbose=False)
    inp = models["midas_transform"](dummy_arr).to(DEVICE)
    with torch.no_grad():
        models["midas"](inp)
    transform = models["reltr_transform"]
    with torch.no_grad():
        models["reltr"](transform(dummy_pil).unsqueeze(0).to(DEVICE))
    print("Warmup complete — all models ready.")