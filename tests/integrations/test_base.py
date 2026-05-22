import pytest
from granbridge.integrations.base import Plugin

def test_plugin_is_abstract():
    with pytest.raises(TypeError):
        Plugin({})
