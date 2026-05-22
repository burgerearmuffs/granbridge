"""Frozen entrypoint: no args -> serve+open browser; else the CLI."""
import sys


def main() -> None:
    from granbridge.cli import app
    if len(sys.argv) == 1:
        sys.argv += ["serve", "--open"]
    app()


if __name__ == "__main__":
    main()
