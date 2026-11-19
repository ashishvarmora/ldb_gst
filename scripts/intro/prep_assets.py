"""
One-time asset prep for the realistic intro scene.

    blender -b -P scripts/intro/prep_assets.py -- <assets dir>

Imports the Poly Haven glTF models (CC0), reduces the heavy hero trees to a
GPU-friendly triangle count, and saves everything - one collection per
asset - into <assets dir>/library.blend, which build_real.py links from.
"""

import os
import sys

import time

import bpy

ASSETS = sys.argv[sys.argv.index("--") + 1]
# target triangle counts per asset (None = keep as is)
MODELS = {

    "fir_sapling_medium": 60_000,
    "grass_medium_01": None,
    "rock_moss_set_01": None,
    "shrub_02": None,
    "street_lamp_01": None,
    "concrete_road_barrier": None,
    "modular_electricity_poles": None,
    "jacaranda_tree": 120_000,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
T0 = time.time()
for name, target in MODELS.items():
    print("importing", name, flush=True)
    path = os.path.join(ASSETS, name, f"{name}_1k.gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    tris = 0
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        if o.type == "MESH":
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    if target and tris > target:
        ratio = target / tris
        for o in objs:
            if o.type != "MESH":
                continue
            bpy.context.view_layer.objects.active = o
            m = o.modifiers.new("dec", "DECIMATE")
            m.ratio = ratio
            m.use_collapse_triangulate = True
            with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
                bpy.ops.object.modifier_apply(modifier="dec")
    after = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
    print(f"ASSET {name}: {len(objs)} objects, {tris} -> {after} tris  ({time.time() - T0:.0f}s)", flush=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ASSETS, "library.blend"), compress=True)
print("SAVED library.blend")
