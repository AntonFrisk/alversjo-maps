def test_sound_class_set_for_all_features(map_features):
    map_name, features = map_features
    missing = [
        f"id={f['id']} title={f['properties'].get('title', '(no title)')}"
        for f in features
        if not f["properties"].get("sound-class")
    ]
    assert not missing, f"{map_name}: features missing sound-class:\n" + "\n".join(missing)


def test_sound_class_num_set_for_all_features(map_features):
    map_name, features = map_features
    missing = [
        f"id={f['id']} title={f['properties'].get('title', '(no title)')}"
        for f in features
        if "sound-class-num" not in f["properties"]
    ]
    assert not missing, f"{map_name}: features missing sound-class-num:\n" + "\n".join(missing)
