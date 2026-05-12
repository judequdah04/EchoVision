import datetime
import sys
sys.path.insert(0, "/workspace/echovision")
from core.firebase import get_items_table

def db_lookup(item_name, user_id="shared"):
    item_name = item_name.lower().strip()
    docs      = get_items_table(user_id).where("item", "==", item_name).stream()
    results   = [doc.to_dict() for doc in docs]
    return results[0] if results else None

def db_save(item_name, location, user_id="shared"):
    item_name = item_name.lower().strip()
    location  = location.lower().strip()
    table     = get_items_table(user_id)
    docs      = list(table.where("item", "==", item_name).stream())
    record    = {
        "item":     item_name,
        "location": location,
        "date":     datetime.date.today().strftime("%Y-%m-%d"),
        "time":     datetime.datetime.now().strftime("%H:%M:%S"),
    }
    if docs:
        table.document(docs[0].id).update(record)
    else:
        table.add(record)
    return record

def run_identify(item_name, location, user_id="shared"):
    if not item_name or not item_name.strip():
        return "Item name is missing. Please try again."
    if not location or not location.strip():
        return "Location is missing. Please try again."
    existing = db_lookup(item_name, user_id)
    record   = db_save(item_name, location, user_id)
    if existing:
        return f"Updated. Your {record['item']} has been moved to the {record['location']}."
    else:
        return f"Got it. Your {record['item']} has been registered in the {record['location']} on {record['date']}."