from granbridge_broker.turn import make_turn_credentials


def test_credentials_match_coturn_rest_contract():
    creds = make_turn_credentials("s3cr3t", "play.example.com", ttl=100, now=1000.0)
    assert creds["username"] == "1100"            # str(int(now) + ttl)
    assert creds["ttl"] == 100
    assert creds["credential"] == "Vf1suDAWMebQxjdiMxGQT+a1wFM="
    assert creds["uris"] == ["turns:play.example.com:443?transport=tcp"]


def test_public_host_port_and_transport_override():
    creds = make_turn_credentials(
        "k", "play.example.com", 60, 1000.0,
        public_host="turn.example.com", public_port=8443, transport="tcp",
    )
    assert creds["uris"] == ["turns:turn.example.com:8443?transport=tcp"]


def test_username_advances_with_now():
    a = make_turn_credentials("k", "d", 60, 1000.0)["username"]
    b = make_turn_credentials("k", "d", 60, 2000.0)["username"]
    assert int(b) - int(a) == 1000
