UUID := gnomecross@deanp
EXT_DIR ?= $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA := org.gnome.shell.extensions.gnomecross.gschema.xml
SOURCES := extension.js gesture.js prefs.js metadata.json
SCHEMAS := schemas/$(SCHEMA)
PACK_DIR := build/$(UUID)

.PHONY: all test install uninstall enable disable pack clean

all: test

test:
	node --experimental-default-type=module tests/gesture.test.mjs

install:
	install -d "$(EXT_DIR)" "$(EXT_DIR)/schemas"
	install -m 644 $(SOURCES) "$(EXT_DIR)/"
	install -m 644 $(SCHEMAS) "$(EXT_DIR)/schemas/"
	glib-compile-schemas --strict "$(EXT_DIR)/schemas"
	@echo "Installed to $(EXT_DIR)"
	@echo "Log out and back in so GNOME Shell can load the extension."

enable:
	@python3 -c 'import ast, subprocess, sys; \
		out = subprocess.check_output(["gsettings", "get", "org.gnome.shell", "enabled-extensions"], text=True).strip(); \
		value = out.split(" ", 1)[1] if out.startswith("@as ") else out; \
		exts = ast.literal_eval(value); \
		exts = exts if "$(UUID)" in exts else exts + ["$(UUID)"]; \
		subprocess.check_call(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(exts)]); \
		print("Enabled $(UUID)")'
	@echo "Log out and back in to activate it."

disable:
	@python3 -c 'import ast, subprocess; \
		out = subprocess.check_output(["gsettings", "get", "org.gnome.shell", "enabled-extensions"], text=True).strip(); \
		value = out.split(" ", 1)[1] if out.startswith("@as ") else out; \
		exts = [e for e in ast.literal_eval(value) if e != "$(UUID)"]; \
		subprocess.check_call(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(exts)]); \
		print("Disabled $(UUID)")'

uninstall: disable
	rm -rf "$(EXT_DIR)"

pack:
	rm -rf build
	install -d "$(PACK_DIR)/schemas"
	install -m 644 $(SOURCES) "$(PACK_DIR)/"
	install -m 644 $(SCHEMAS) "$(PACK_DIR)/schemas/"
	glib-compile-schemas --strict "$(PACK_DIR)/schemas"
	gnome-extensions pack --force --extra-source=gesture.js --out-dir=. "$(PACK_DIR)"

clean:
	rm -rf build
