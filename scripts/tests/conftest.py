import importlib.util
import pathlib
import sys

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"


def _load():
    name = "fetch_schedules"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "fetch-schedules.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # dataclasses need the module registered
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def fs():
    return _load()


def load_pages(name: str) -> list[str]:
    """Fixture files separate PDF pages with a '<<<PAGE>>>' line."""
    text = (FIXTURES / name).read_text(encoding="utf-8")
    return [p.strip("\n") for p in text.split("<<<PAGE>>>")]


@pytest.fixture
def pages():
    return load_pages
