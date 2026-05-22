from granbridge.events.schema_export import export_schemas
from granbridge.events.models import DartHit

def test_export_writes_one_schema_per_event(tmp_path):
    written = export_schemas(tmp_path)
    assert (tmp_path / "dart_hit.json").exists()
    assert "dart_hit" in written
    import json
    schema = json.loads((tmp_path / "dart_hit.json").read_text())
    assert schema["title"] == "DartHit"
