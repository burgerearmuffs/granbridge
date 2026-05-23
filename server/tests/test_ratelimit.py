from granbridge_broker.ratelimit import RateLimiter, client_ip


def test_allows_under_limit_then_blocks_at_limit():
    rl = RateLimiter(limit=2, window=60.0)
    assert rl.allow("a", 1000.0) is True
    assert rl.allow("a", 1000.1) is True
    assert rl.allow("a", 1000.2) is False   # 3rd in window → blocked


def test_window_slides():
    rl = RateLimiter(limit=1, window=10.0)
    assert rl.allow("a", 1000.0) is True
    assert rl.allow("a", 1005.0) is False    # still in window
    assert rl.allow("a", 1011.0) is True     # old event aged out


def test_keys_are_independent():
    rl = RateLimiter(limit=1, window=60.0)
    assert rl.allow("a", 1000.0) is True
    assert rl.allow("b", 1000.0) is True


def test_zero_or_negative_limit_disables():
    rl = RateLimiter(limit=0, window=60.0)
    for i in range(100):
        assert rl.allow("a", 1000.0 + i) is True


def test_prune_drops_idle_keys():
    rl = RateLimiter(limit=5, window=10.0)
    rl.allow("a", 1000.0)
    rl.prune(1020.0)                          # 'a' idle past the window
    assert rl.key_count() == 0


def test_client_ip_prefers_x_real_ip():
    assert client_ip({"X-Real-IP": "1.2.3.4"}, ("10.0.0.1", 555)) == "1.2.3.4"


def test_client_ip_falls_back_to_remote_then_unknown():
    assert client_ip({}, ("10.0.0.1", 555)) == "10.0.0.1"
    assert client_ip({}, None) == "unknown"
