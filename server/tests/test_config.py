from granbridge_broker.config import resolve_secret, from_env


def test_resolve_secret_prefers_env(tmp_path):
    f = tmp_path / "turn_secret"
    f.write_text("from-file")
    assert resolve_secret("from-env", str(f)) == "from-env"


def test_resolve_secret_reads_file_when_env_absent(tmp_path):
    f = tmp_path / "turn_secret"
    f.write_text("  file-secret\n")
    assert resolve_secret(None, str(f)) == "file-secret"


def test_from_env_parses_and_defaults():
    env = {"TURN_SECRET": "x", "DOMAIN": "play.example.com", "ALLOWED_ORIGINS": "a, b"}
    cfg = from_env(env)
    assert cfg.turn_secret == "x"
    assert cfg.turn_domain == "play.example.com"
    assert cfg.allowed_origins == ("a", "b")
    assert cfg.port == 8788
    assert cfg.max_rooms == 200
    assert cfg.room_size_cap == 4
    assert cfg.max_size == 65536
    assert cfg.turn_ttl == 86400


def test_from_env_origins_empty_means_permissive():
    cfg = from_env({"TURN_SECRET": "x", "DOMAIN": "d"})
    assert cfg.allowed_origins is None


def test_stats_config_defaults_disabled(tmp_path):
    cfg = from_env({"DOMAIN": "x.test", "TURN_SECRET": "s"})
    assert cfg.stats_db_path == ""           # empty => stats disabled
    assert cfg.stats_rate_per_min == 30


def test_stats_config_from_env(tmp_path):
    cfg = from_env({"DOMAIN": "x.test", "TURN_SECRET": "s",
                    "STATS_DB_PATH": "/data/stats.db", "STATS_RATE_PER_MIN": "5"})
    assert cfg.stats_db_path == "/data/stats.db"
    assert cfg.stats_rate_per_min == 5
