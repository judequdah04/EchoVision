import firebase_admin
from firebase_admin import credentials, firestore

_db = None
def get_db():
    global _db
    if _db is None:
        if not firebase_admin._apps:
            cred = credentials.Certificate("/workspace/echovision/models/firebase_key.json")
            firebase_admin.initialize_app(cred)
        _db = firestore.client()
    return _db

def get_items_table(user_id="shared"):
    """Each user gets their own subcollection under Users/{user_id}/Items_Stored"""
    return get_db().collection("Users").document(user_id).collection("Items_Stored")

def get_sticker_table(user_id="shared"):
    """Each user gets their own subcollection under Users/{user_id}/Sticker_Profile"""
    return get_db().collection("Users").document(user_id).collection("Sticker_Profile")
