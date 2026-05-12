import sys
sys.path.insert(0, "/workspace/echovision")
from modules.identify import db_lookup

def run_where(item_name, user_id="shared"):
    if not item_name or not item_name.strip():
        return "Item name is missing. Please try again."
    record = db_lookup(item_name, user_id)
    if record is None:
        return f"I don't have {item_name} registered. Please identify it first."
    return (
        f"Your {record['item']} was last seen in the {record['location']} "
        f"on {record['date']} at {record.get('time', '')}. "
        f"Please go to the {record['location']}."
    )