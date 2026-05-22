from granbridge.integrations.plugins.logging_plugin import LoggingPlugin
from granbridge.events.models import DartHit, Ring

async def test_logging_plugin_handles_without_error():
    p = LoggingPlugin({})
    await p.start()
    await p.handle(DartHit(raw="T20@", ring=Ring.TRIPLE, segment=20, multiplier=3, bed="T20", score=60))
    await p.stop()  # no exception == pass
