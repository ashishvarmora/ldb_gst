"""
Rahdari opening intro v3 - a drone shot over a highway toll plaza, built in code.

    blender -b -P scripts/intro/build_drone.py -- --assets <dir> --mode stills --out <dir> [--times 0,1.5,2.6,5] [--pct 50] [--samples 32]
    blender -b -P scripts/intro/build_drone.py -- --assets <dir> --mode anim   --out <dir> [--samples 64]

<assets> holds the CC0 Poly Haven downloads (hdri/, tex/, library.blend made by
prep_assets.py). Nothing here ships to users: it renders frames that are encoded
into public/intro/.

Story (5 s, 30 fps):
  0.0-1.5  wide drone shot, ~70 m up and ~360 m back: a morning highway through
           farm fields (wheat, mustard, ploughed), wind turbines turning, the
           toll plaza small ahead, cumulus sky
  1.5-3.0  the drone descends toward the truck; FASTag reader blinks, the lane
           signal turns green, the boom lifts
  3.0-4.2  the drone rises over the canopy as the truck rolls through
  4.2-5.0  settles 3/4 rear-top on the truck: roof and side wordmark in view
           (the web layer lifts them into the site's navbar)

Generic by design: no vehicle numbers, plaza names or people.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intro_lib import (TEX_ROOT, cyl, ease_out_back, empty, key, lin, link, macro_var, material, mesh_from,  # noqa: E402
                       monotone, noisy, pbr, rbox, set_in, set_parent, smooth, smoothstep, stripes, text_obj,
                       vec_keys)

# --------------------------------------------------------------- arguments
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ARGS = {"mode": "stills", "out": os.path.join(os.getcwd(), "intro-render"), "samples": None, "pct": None,
        "times": "0,1.5,2.6,5", "mb": "1", "assets": "", "haze": "1", "trees": "1", "sky": "kloofendal_48d_partly_cloudy_puresky",
        "exposure": "0.0", "frames": None}
for i in range(0, len(argv) - 1, 2):
    ARGS[argv[i].lstrip("-")] = argv[i + 1]
ASSETS = ARGS["assets"]
TEX_ROOT[0] = ASSETS

FPS = 30
DUR = 5.0
FRAMES = int(DUR * FPS)
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_ARIAL = "C:/Windows/Fonts/arialbd.ttf"
rng = random.Random(7)


def T(f):
    return (f - 1) / FPS


def F(t):
    return int(round(t * FPS)) + 1


# ------------------------------------------------------------- reset scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 1
scene.frame_end = FRAMES


def collect(name, objs):
    """Moves objects out of the scene into a collection used for instancing."""
    col = bpy.data.collections.new(name)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    return col


def built(fn):
    before = set(bpy.data.objects)
    fn()
    return [o for o in bpy.data.objects if o not in before]


def inst(col, loc, rz=0.0, s=1.0):
    e = bpy.data.objects.new(col.name + "_i", None)
    e.instance_type = "COLLECTION"
    e.instance_collection = col
    e.location = loc
    e.rotation_euler = (0, 0, rz)
    e.scale = (s, s, s) if not isinstance(s, tuple) else s
    link(e)
    return e


# ---------------------------------------------------------------- materials
M = {
    # truck
    "paint_blue": material("paint_blue", "#2766dc", rough=0.24, metal=0.3, coat=1.0, coat_rough=0.03),
    "rib_blue": material("rib_blue", "#2259c6", rough=0.26, metal=0.3, coat=1.0, coat_rough=0.04),
    "paint_white": material("paint_white", "#eef2f7", rough=0.2, metal=0.15, coat=1.0, coat_rough=0.03),
    "chrome": material("chrome", "#e6ebf2", rough=0.07, metal=1.0),
    "alu": material("alu", "#aab4c2", rough=0.3, metal=1.0),
    "plastic": material("plastic", "#20252e", rough=0.55),
    "glass": material("glass", "#0a1424", rough=0.02, coat=1.0, spec=1.0),
    "rubber": material("rubber", "#121418", rough=0.85, spec=0.25),
    "rim": material("rim", "#b9c2cf", rough=0.22, metal=1.0),
    "lamp": material("lamp", "#ffffff", rough=0.05, emit="#fff1d6", strength=6.0),
    "tail": material("tail", "#ff1f1f", rough=0.15, emit="#ff2020", strength=2.0),
    "orange": material("orange", "#ff7a14", rough=0.25, metal=0.2, coat=1.0),
    "letters": material("letters", "#ffffff", rough=0.25, coat=0.6, emit="#ffffff", strength=0.08),
    # plaza
    "fascia": material("fascia", "#f4f6f8", rough=0.3, metal=0.1, coat=0.4),
    "band": material("band", "#1d55c2", rough=0.3, metal=0.4, coat=0.6),
    "booth": material("booth", "#eef1f4", rough=0.35, metal=0.1),
    "booth_glass": material("booth_glass", "#20374f", rough=0.05, coat=1.0, spec=1.0),
    "dark": material("dark", "#14181f", rough=0.4),
    "pole": material("pole", "#9aa3ad", rough=0.35, metal=0.9),
    "sig_green": material("sig_green", "#1fdc6b", rough=0.2, emit="#2bff7e", strength=0.0),
    "sig_red": material("sig_red", "#ff2b2b", rough=0.2, emit="#ff2b2b", strength=6.0),
    "sig_red_static": material("sig_red_static", "#ff2b2b", rough=0.2, emit="#ff2b2b", strength=6.0),
    "plaza_text": material("plaza_text", "#ffffff", rough=0.3, emit="#ffffff", strength=0.6),
    "reader_led": material("reader_led", "#9fe6ff", rough=0.2, emit="#7fdcff", strength=0.0),
    "yellow": material("yellow", "#ffc21a", rough=0.35, coat=0.5),
    "paint_w": material("paint_w", "#f1f1ec", rough=0.6, spec=0.4),
    "paint_y": material("paint_y", "#f2c230", rough=0.6, spec=0.4),
    "sign_green": material("sign_green", "#0d6b3c", rough=0.4, spec=0.5),
    "sign_text": material("sign_text", "#ffffff", rough=0.3, emit="#ffffff", strength=0.3),
    "turbine": material("turbine", "#eef0f2", rough=0.32, spec=0.5),
    "lamp_head": material("lamp_head", "#b8c0c8", rough=0.3, metal=0.7),
    "water": material("water", "#20403f", rough=0.03, spec=1.0),
    "building": material("building", "#e9e4da", rough=0.6),
    "roof_dark": material("roof_dark", "#6f767e", rough=0.5, metal=0.4),
}
boom_mat = stripes(material("boom", "#ffffff", rough=0.3, coat=0.6), "#f4f6f9", "#e3262b", scale=1.6, axis="Y")
hazard = stripes(material("hazard", "#ffcc00", rough=0.45), "#ffc400", "#14161b", scale=4.0, axis="X", coords="Generated")
# canopy roof: light metal sheet with standing seams
roof = material("canopy_roof", "#c9ced4", rough=0.35, metal=0.6)
_rt = roof.node_tree
_wave = _rt.nodes.new("ShaderNodeTexWave")
_wave.inputs["Scale"].default_value = 0.9
_tc = _rt.nodes.new("ShaderNodeTexCoord")
_rt.links.new(_tc.outputs["Object"], _wave.inputs["Vector"])
_bump = _rt.nodes.new("ShaderNodeBump")
_bump.inputs["Strength"].default_value = 0.35
_rt.links.new(_wave.outputs["Fac"], _bump.inputs["Height"])
_rt.links.new(_bump.outputs["Normal"], _rt.nodes["Principled BSDF"].inputs["Normal"])

ASPHALT = pbr("asphalt", "asphalt_02", 0.3, macro=0.14, macro_scale=0.02, tint="#d6d6d6")


def lane_wear(m):
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    src = b.inputs["Base Color"].links[0].from_socket
    N = t.nodes.new
    L = t.links.new

    def math(op, a, bv=None):
        n = N("ShaderNodeMath"); n.operation = op
        L(a, n.inputs[0]) if not isinstance(a, float) else None
        if isinstance(a, float):
            n.inputs[0].default_value = a
        if bv is not None:
            if isinstance(bv, float):
                n.inputs[1].default_value = bv
            else:
                L(bv, n.inputs[1])
        return n.outputs[0]

    def band(v, lo, hi):  # 1 below lo -> 0 above hi
        mr = N("ShaderNodeMapRange"); mr.interpolation_type = "SMOOTHSTEP"
        mr.inputs["From Min"].default_value = lo; mr.inputs["From Max"].default_value = hi
        mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = 0.0
        L(v, mr.inputs["Value"])
        return mr.outputs["Result"]

    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Object"], sep.inputs[0])
    ay = math("ABSOLUTE", sep.outputs["Y"])
    u = math("MULTIPLY", math("SUBTRACT", ay, 2.7), 1 / 5.4)
    f = math("SUBTRACT", math("FRACT", math("ADD", u, 0.5)), 0.5)
    d = math("MULTIPLY", math("ABSOLUTE", f), 5.4)
    zone = band(math("ABSOLUTE", sep.outputs["X"]), 35.0, 80.0)
    nz = N("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 0.6; nz.inputs["Detail"].default_value = 5.0
    L(tc.outputs["Object"], nz.inputs["Vector"])
    oil = math("MULTIPLY", band(d, 0.2, 0.65), math("MULTIPLY", nz.outputs["Fac"], 1.0))
    track = band(math("ABSOLUTE", math("SUBTRACT", d, 0.95)), 0.12, 0.42)
    dark = math("MULTIPLY", math("ADD", math("MULTIPLY", oil, 0.55), math("MULTIPLY", track, 0.14)), zone)
    keep = math("SUBTRACT", 1.0, dark)
    mx = N("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = 1.0
    L(src, mx.inputs[6]); L(keep, mx.inputs[7])
    L(mx.outputs[2], b.inputs["Base Color"])


lane_wear(ASPHALT)
CONCRETE = pbr("concrete", "brushed_concrete", 0.35, tint="#ffffff", macro=0.06)
_cb = CONCRETE.node_tree.nodes["Principled BSDF"]
_lift = CONCRETE.node_tree.nodes.new("ShaderNodeMix"); _lift.data_type = "RGBA"; _lift.blend_type = "SCREEN"
_lift.inputs[0].default_value = 0.45
_lift.inputs[7].default_value = lin("#d9dbdd")
CONCRETE.node_tree.links.new(_cb.inputs["Base Color"].links[0].from_socket, _lift.inputs[6])
CONCRETE.node_tree.links.new(_lift.outputs[2], _cb.inputs["Base Color"])
VERGE = pbr("verge", "grass_ground", 0.3, tint="#b9d48a", macro=0.18, macro_scale=0.05)


def crop_mat(name, tid, tint, scale, row_sp, soil_amt, flower=None, flower_amt=0.0, var=0.16):
    """Field crop seen from the air: texture + tint, soil between crop rows,
    optional flowers (mustard), slow patchy growth variation. UV = metres."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    uv = t.nodes.new("ShaderNodeUVMap").outputs["UV"]

    def tex(tid_, sc):
        mp = t.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (sc, sc, sc)
        t.links.new(uv, mp.inputs["Vector"])
        n = t.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(tex_path(tid_, "Diffuse"), check_existing=True)
        t.links.new(mp.outputs["Vector"], n.inputs["Vector"])
        return n.outputs["Color"]

    col = tex(tid, scale)
    tm = t.nodes.new("ShaderNodeMix"); tm.data_type = "RGBA"; tm.blend_type = "MULTIPLY"
    tm.inputs[0].default_value = 1.0
    tm.inputs[7].default_value = lin(tint)
    t.links.new(col, tm.inputs[6])
    col = tm.outputs[2]
    if soil_amt > 0:
        soil = tex("farm_soil", 0.5)
        sep = t.nodes.new("ShaderNodeSeparateXYZ")
        t.links.new(uv, sep.inputs[0])
        a = t.nodes.new("ShaderNodeMath"); a.operation = "MULTIPLY"; a.inputs[1].default_value = 1.0 / row_sp
        t.links.new(sep.outputs["X"], a.inputs[0])
        fr = t.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
        t.links.new(a.outputs[0], fr.inputs[0])
        sb = t.nodes.new("ShaderNodeMath"); sb.operation = "SUBTRACT"; sb.inputs[1].default_value = 0.5
        t.links.new(fr.outputs[0], sb.inputs[0])
        ab = t.nodes.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"
        t.links.new(sb.outputs[0], ab.inputs[0])
        mr = t.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.22
        mr.inputs["From Max"].default_value = 0.5
        mr.inputs["To Min"].default_value = 0.0
        mr.inputs["To Max"].default_value = soil_amt
        t.links.new(ab.outputs[0], mr.inputs["Value"])
        mx = t.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"
        t.links.new(mr.outputs["Result"], mx.inputs[0])
        t.links.new(col, mx.inputs[6]); t.links.new(soil, mx.inputs[7])
        col = mx.outputs[2]
    if flower:
        nz = t.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.2
        nz.inputs["Detail"].default_value = 6.0
        t.links.new(uv, nz.inputs["Vector"])
        fm = t.nodes.new("ShaderNodeMapRange")
        fm.inputs["From Min"].default_value = 0.4
        fm.inputs["From Max"].default_value = 0.56
        fm.inputs["To Min"].default_value = 0.0
        fm.inputs["To Max"].default_value = flower_amt
        t.links.new(nz.outputs["Fac"], fm.inputs["Value"])
        mx = t.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"
        mx.inputs[7].default_value = lin(flower)
        t.links.new(fm.outputs["Result"], mx.inputs[0])
        t.links.new(col, mx.inputs[6])
        col = mx.outputs[2]
    col = macro_var(t, uv, col, var, 0.03)
    t.links.new(col, b.inputs["Base Color"])
    set_in(b, "Roughness", 0.9)
    set_in(b, ["Specular IOR Level", "Specular"], 0.25)
    return m


def tex_path(tid, kind):
    from intro_lib import tex_path as tp
    return tp(tid, kind)


FIELD_MATS = [
    ("wheat", crop_mat("f_wheat", "grass_ground", "#8fe04a", 0.35, 0.9, 0.3, var=0.22), 0.42),
    ("young", crop_mat("f_young", "grass_ground", "#c6ee6a", 0.35, 1.2, 0.5, var=0.2), 0.2),
    ("mustard", crop_mat("f_mustard", "grass_ground", "#9ccf52", 0.35, 0.9, 0.15, flower="#eec22a", flower_amt=0.7, var=0.25), 0.11),
    ("plough", pbr("f_plough", "farm_furrows", 0.4, coords="UV", tint="#f6e8d4", macro=0.14), 0.13),
    ("fallow", pbr("f_fallow", "dirt_aerial_02", 0.06, coords="UV", tint="#fff4e4", macro=0.18), 0.08),
]



def add_fvar(m):
    t = m.node_tree
    b = t.nodes["Principled BSDF"]
    src = b.inputs["Base Color"].links[0].from_socket
    at = t.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "fvar"
    mx = t.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = 1.0
    t.links.new(src, mx.inputs[6]); t.links.new(at.outputs["Color"], mx.inputs[7])
    t.links.new(mx.outputs[2], b.inputs["Base Color"])


for _, _m, _ in FIELD_MATS:
    add_fvar(_m)

# ground under and around the fields: grass with bare soil patches
GROUND = pbr("ground", "grass_ground", 0.25, tint="#c4d08e", macro=0.2, macro_scale=0.004)

# ------------------------------------------------------------------- world
SUN_EL = math.radians(23)
SUN_AZ = math.radians(118)  # sun behind-left of the camera: lit truck side faces the drone
SUN_DIR = Vector((math.cos(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_EL)))

world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
wt = world.node_tree
for n in list(wt.nodes):
    wt.nodes.remove(n)
w_out = wt.nodes.new("ShaderNodeOutputWorld")
w_env = wt.nodes.new("ShaderNodeTexEnvironment")
w_env.image = bpy.data.images.load(os.path.join(ASSETS, "hdri", ARGS["sky"] + "_4k.hdr"), check_existing=True)
w_map = wt.nodes.new("ShaderNodeMapping")
w_tc = wt.nodes.new("ShaderNodeTexCoord")
wt.links.new(w_tc.outputs["Generated"], w_map.inputs["Vector"])
wt.links.new(w_map.outputs["Vector"], w_env.inputs["Vector"])
w_cam = wt.nodes.new("ShaderNodeBackground")
w_cam.inputs["Strength"].default_value = 1.15
wt.links.new(w_env.outputs["Color"], w_cam.inputs["Color"])
# for lighting, the HDRI's own (midday) sun is clamped away; our low morning sun lamp replaces it
w_min = wt.nodes.new("ShaderNodeVectorMath"); w_min.operation = "MINIMUM"
w_min.inputs[1].default_value = (2.2, 2.2, 2.2)
wt.links.new(w_env.outputs["Color"], w_min.inputs[0])
w_light = wt.nodes.new("ShaderNodeBackground")
w_light.inputs["Strength"].default_value = 1.0
wt.links.new(w_min.outputs["Vector"], w_light.inputs["Color"])
w_lp = wt.nodes.new("ShaderNodeLightPath")
w_mix = wt.nodes.new("ShaderNodeMixShader")
wt.links.new(w_lp.outputs["Is Camera Ray"], w_mix.inputs[0])
wt.links.new(w_light.outputs[0], w_mix.inputs[1])
wt.links.new(w_cam.outputs[0], w_mix.inputs[2])
wt.links.new(w_mix.outputs[0], w_out.inputs["Surface"])

# align the HDRI's sun azimuth with our sun so cloud lighting agrees
try:
    import numpy as np
    img = w_env.image
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    lum = px.reshape(H, W, 4)[H // 2:, :, :3].sum(axis=2)  # upper hemisphere only
    iy, ix = np.unravel_index(int(np.argmax(lum)), lum.shape)
    iy += H // 2
    del px, lum
    az_img = ((ix + 0.5) / W - 0.5) * 2 * math.pi
    rot = math.pi - az_img - SUN_AZ
    w_map.inputs["Rotation"].default_value = (0, 0, rot)
    print("HDRI sun px", ix, iy, "rot deg", round(math.degrees(rot), 1))
except Exception as e:  # noqa: BLE001
    print("HDRI align skipped", e)

sd = bpy.data.lights.new("sun", "SUN")
sd.energy = 5.0
sd.angle = math.radians(0.8)
sd.color = lin("#ffd7a6")[:3]
sun = bpy.data.objects.new("sun", sd)
link(sun)
sun.rotation_euler = (-SUN_DIR).to_track_quat("-Z", "Y").to_euler()

# ------------------------------------------------------------------ terrain
GROUND_Z = -0.45
rbox("ground", (30000, 30000, 0.2), (0, 0, GROUND_Z - 0.1), GROUND, bevel=0)

# distant low hills in the haze for depth
for hx, hy, sx, sy, sz in []:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0, location=(hx, hy, GROUND_Z))
    h = bpy.context.active_object
    h.scale = (sx, sy, sz)
    smooth(h)
    h.data.materials.append(GROUND)


# ------------------------------------------------------------------ highway
def hw(x):
    """half width of the paved surface: 11.5 on the open highway, 24 at the plaza"""
    return 11.5 + 12.5 * (1 - smoothstep(42.0, 175.0, abs(x)))


XS = sorted(set([round(v, 3) for v in
                 [-4000 + 50 * k for k in range(0, 76)] + [-250 + 2.5 * k for k in range(0, 201)] + [250 + 50 * k for k in range(0, 76)]]))
# deck
dv, df = [], []
for i, x in enumerate(XS):
    w = hw(x)
    dv += [(x, -w, 0.0), (x, w, 0.0)]
    if i:
        a = 2 * (i - 1)
        df.append((a, a + 2, a + 3, a + 1))
mesh_from("deck", dv, df, ASPHALT)
# embankments: shoulder edge -> field level
for side in (-1, 1):
    ev, ef = [], []
    for i, x in enumerate(XS):
        w = hw(x)
        ev += [(x, side * w, 0.0), (x, side * (w + 0.6), -0.02), (x, side * (w + 5.5), GROUND_Z + 0.02)]
        if i:
            a = 3 * (i - 1)
            if side > 0:
                ef += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
            else:
                ef += [(a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
    mesh_from("embank", ev, ef, VERGE)
# concrete pad at the booths
rbox("plaza_pad", (34, 50, 0.04), (0, 0, 0.0), CONCRETE, bevel=0)

MED = 2.0  # median half width on the open highway
MED_END = 58.0


def median_strip(x0, x1):
    L = x1 - x0
    cx = (x0 + x1) / 2
    rbox("median", (L, 2 * MED, 0.2), (cx, 0, 0.1), VERGE, bevel=0)
    for s in (-1, 1):
        rbox("kerb", (L, 0.25, 0.24), (cx, s * (MED - 0.12), 0.12), CONCRETE, bevel=0.03)
    # galvanised W-beam with posts, both sides
    for s in (-1, 1):
        rbox("wbeam", (L, 0.08, 0.32), (cx, s * (MED - 0.5), 0.62), M["pole"], bevel=0.02)
        post = rbox("post", (0.12, 0.12, 0.75), (x0 + 1, s * (MED - 0.42), 0.4), M["pole"], bevel=0)
        ar = post.modifiers.new("arr", "ARRAY")
        ar.fit_type = "FIXED_COUNT"
        ar.count = int(L / 4)
        ar.use_relative_offset = False
        ar.use_constant_offset = True
        ar.constant_offset_displace = (4.0, 0, 0)
    for xe in (x0, x1):
        if abs(xe) < 100:
            rbox("median_nose", (1.4, 2 * MED + 0.1, 0.32), (xe, 0, 0.16), hazard, bevel=0.2)


median_strip(-4000, -MED_END)
median_strip(MED_END, 4000)

# markings
mv, mf = [], []
yv, yf = [], []


def mark(verts, faces, x0, x1, y0, y1, z=0.012):  # noqa: PLR0913
    b = len(verts)
    verts += [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
    faces.append((b, b + 1, b + 2, b + 3))


for sgn in (-1, 1):
    # open highway: yellow inner edge, white outer edge, dashed lane line
    for xa, xb in ((-2500, -MED_END - 4), (MED_END + 4, 2500)):
        mark(yv, yf, xa, xb, sgn * 2.35 - 0.075, sgn * 2.35 + 0.075)
    x = -2500.0
    while x < 2500:
        if abs(x) > 175:
            mark(mv, mf, x, x + 4.5, sgn * 5.85 - 0.075, sgn * 5.85 + 0.075)
        x += 12.0
    for xa, xb in ((-2500, -175), (175, 2500)):
        mark(mv, mf, xa, xb, sgn * 9.4 - 0.08, sgn * 9.4 + 0.08)
# rumble bars before the plaza (our side approaches from -x on +y, the other from +x on -y)
for sgn in (-1, 1):
    for x0 in (150, 125, 100):
        for k in range(6):
            x = -sgn * (x0 + k * 0.9)
            w = hw(x)
            if sgn > 0:
                mark(yv, yf, x, x + 0.35, 2.5, w - 0.4)
            else:
                mark(yv, yf, x, x + 0.35, -w + 0.4, -2.5)
mesh_from("marks_w", mv, mf, M["paint_w"])
mesh_from("marks_y", yv, yf, M["paint_y"])

# ------------------------------------------------------------- toll plaza
ISL = [0.0, 5.4, 10.8, 16.2, 21.6]
LANES_POS = [2.7, 8.1, 13.5, 18.9]
HERO_Y = 8.1
CAN_X = 7.0
CAN_Z = 6.0
CAN_T = 1.2
for y0 in ISL:
    for s in ((1,) if y0 == 0 else (-1, 1)):
        y = s * y0
        w = 2.4 if y0 == 0 else 1.8
        rbox("island", (26, w, 0.25), (0, y, 0.125), CONCRETE, bevel=0.05)
        for xe in (-13.3, 13.3):
            rbox("island_nose", (1.0, w + 0.04, 0.32), (xe, y, 0.16), hazard, bevel=0.25)
        for xc in (-4.5, 4.5):
            cyl("column", 0.38, CAN_Z, (xc, y, CAN_Z / 2), CONCRETE, verts=32)
# booths: +y lanes (traffic +x) have the booth on the island to their right (-y side)
for ly in LANES_POS:
    for s in (-1, 1):
        y_isl = s * (ly - 2.7)  # the island on the driver's right (right-hand drive, keep left)
        bx = -0.8 if s > 0 else 0.8
        rbox("booth", (3.0, 1.3, 2.5), (bx, y_isl, 1.5), M["booth"], bevel=0.08)
        rbox("booth_glass", (2.4, 1.34, 0.95), (bx, y_isl, 2.0), M["booth_glass"], bevel=0.03)
        rbox("booth_roof", (3.3, 1.6, 0.14), (bx, y_isl, 2.82), M["band"], bevel=0.04)
# canopy
HALF_W = ISL[-1] + 2.6
rbox("canopy_core", (2 * CAN_X - 0.4, 2 * HALF_W - 0.4, CAN_T - 0.1), (0, 0, CAN_Z + CAN_T / 2), M["fascia"], bevel=0.05)
rbox("canopy_roof", (2 * CAN_X - 0.6, 2 * HALF_W - 0.6, 0.06), (0, 0, CAN_Z + CAN_T + 0.0), roof, bevel=0)
solar = material("solar", "#0f1f3d", rough=0.08, coat=1.0, spec=0.8)
_st = solar.node_tree
_br = _st.nodes.new("ShaderNodeTexBrick")
_br.offset = 0.0
_br.inputs["Color1"].default_value = lin("#10213f")
_br.inputs["Color2"].default_value = lin("#152a4d")
_br.inputs["Mortar"].default_value = lin("#8c96a6")
_br.inputs["Scale"].default_value = 6.0
_br.inputs["Mortar Size"].default_value = 0.012
_br.inputs["Brick Width"].default_value = 0.5
_br.inputs["Row Height"].default_value = 0.25
_stc = _st.nodes.new("ShaderNodeTexCoord")
_st.links.new(_stc.outputs["Object"], _br.inputs["Vector"])
_st.links.new(_br.outputs["Color"], _st.nodes["Principled BSDF"].inputs["Base Color"])
for px_ in (-5.0, -2.5, 0.0, 2.5, 5.0):
    pnl = rbox("solar_row", (2.0, 0.98, 0.05), (px_, -HALF_W + 1.2, CAN_Z + CAN_T + 0.32), solar, bevel=0.01, rot=(0, math.radians(-12), 0))
    ar_ = pnl.modifiers.new("arr", "ARRAY")
    ar_.fit_type = "FIXED_COUNT"
    ar_.count = int((2 * HALF_W - 2.4) / 1.02)
    ar_.use_relative_offset = False
    ar_.use_constant_offset = True
    ar_.constant_offset_displace = (0, 1.02, 0)
    rbox("solar_rail", (0.08, 2 * HALF_W - 2.2, 0.25), (px_ + 0.85, 0, CAN_Z + CAN_T + 0.14), M["pole"], bevel=0)
for sx in (-1, 1):
    rbox("fascia", (0.3, 2 * HALF_W + 0.3, CAN_T + 0.25), (sx * CAN_X, 0, CAN_Z + CAN_T / 2 + 0.05), M["fascia"], bevel=0.06)
    rbox("band", (0.32, 2 * HALF_W + 0.32, 0.38), (sx * CAN_X, 0, CAN_Z + 0.32), M["band"], bevel=0.03)
for sy in (-1, 1):
    rbox("fascia_end", (2 * CAN_X + 0.3, 0.3, CAN_T + 0.25), (0, sy * HALF_W, CAN_Z + CAN_T / 2 + 0.05), M["fascia"], bevel=0.06)
# generic plaza sign on both approach faces
for sx, rz in ((-1, -math.pi / 2), (1, math.pi / 2)):
    for yc in (-11.0, 11.0):
        tx = text_obj("plaza_text", "TOLL PLAZA", 0.95, M["band"], FONT_BOLD, extrude=0.02)
        tx.location = (sx * (CAN_X + 0.17), yc, CAN_Z + 0.95)
        tx.rotation_euler = (math.radians(90), 0, rz)
    # lane signals under the fascia
    for ly in LANES_POS:
        y = ly if sx < 0 else -ly
        rbox("signal_box", (0.25, 1.0, 0.6), (sx * (CAN_X - 0.45), y, CAN_Z - 0.32), M["dark"], bevel=0.05)
        is_hero = sx < 0 and abs(y - HERO_Y) < 0.01
        sym = text_obj("sig", "\u00d7", 0.7, M["sig_red"] if is_hero else M["sig_red_static"], FONT_ARIAL, extrude=0.01)
        sym.location = (sx * (CAN_X - 0.29), y, CAN_Z - 0.32)
        sym.rotation_euler = (math.radians(90), 0, rz)
        if is_hero:
            sig_red_hero = sym
            g = text_obj("sig_arrow", "\u2193", 0.6, M["sig_green"], FONT_ARIAL, extrude=0.01)
            g.location = (sx * (CAN_X - 0.30), y, CAN_Z - 0.32)
            g.rotation_euler = (math.radians(90), 0, rz)
        # FASTag reader above each lane
        rbox("reader", (0.5, 1.1, 0.32), (sx * 3.0, y, CAN_Z - 0.25), M["dark"], bevel=0.05)
        rbox("reader_led", (0.05, 0.9, 0.07), (sx * 3.27, y, CAN_Z - 0.3), M["reader_led"] if is_hero else M["dark"], bevel=0.01)
# booms: one per lane at the exit side; the hero lane's lifts
BOOM_X = 3.6
hero_pivot = None
for ly in LANES_POS:
    for s in (-1, 1):
        lane_y = s * ly
        if s > 0:
            py, dirn, bx = lane_y - 2.15, 1, BOOM_X
        else:
            py, dirn, bx = lane_y + 2.15, -1, -BOOM_X
        rbox("boom_cab", (0.45, 0.45, 1.0), (bx, py, 0.75), M["yellow"], bevel=0.06)
        pv = empty("boom_pivot", (bx, py, 1.15))
        cyl("boom", 0.05, 3.5, (bx, py + dirn * 1.85, 1.15), boom_mat, rot=(math.radians(90), 0, 0), verts=16, parent=pv, bevel=0)
        if s > 0 and abs(lane_y - HERO_Y) < 0.01:
            hero_pivot = pv
# plaza lane lines leading to the islands
lv, lf = [], []
for y0 in ISL[1:]:
    for s in (-1, 1):
        mark(lv, lf, -45, -13.5, s * y0 - 0.075, s * y0 + 0.075, z=0.026)
        mark(lv, lf, 13.5, 45, s * y0 - 0.075, s * y0 + 0.075, z=0.026)
mesh_from("plaza_lines", lv, lf, M["paint_w"])

# high-mast lights around the plaza
for hx, hy in ((-34, 30), (34, -30), (34, 30), (-34, -30)):
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.45, radius2=0.18, depth=24, location=(hx, hy, 12))
    mst = bpy.context.active_object
    smooth(mst)
    mst.data.materials.append(M["pole"])
    bpy.ops.mesh.primitive_torus_add(major_radius=1.2, minor_radius=0.12, location=(hx, hy, 23.6))
    tor = bpy.context.active_object
    tor.data.materials.append(M["pole"])
    for k in range(6):
        a = k * math.pi / 3
        rbox("mast_lamp", (0.7, 0.4, 0.22), (hx + 1.3 * math.cos(a), hy + 1.3 * math.sin(a), 23.5), M["lamp_head"], bevel=0.05, rot=(0, 0, a))

# plaza office building and parking (beside the +y side)
rbox("office", (22, 11, 7.2), (42, 46, 3.6 - 0.2), M["building"], bevel=0.15)
rbox("office_glass", (22.1, 11.1, 1.6), (42, 46, 4.6), M["booth_glass"], bevel=0.05)
rbox("office_roof", (23, 12, 0.4), (42, 46, 7.4), M["roof_dark"], bevel=0.08)
rbox("office_lot", (40, 26, 0.05), (42, 44, -0.02), ASPHALT, bevel=0)
rbox("office_drive", (8, 14, 0.05), (30, 26, -0.02), ASPHALT, bevel=0)

# overhead sign gantry before the plaza
GX = -235.0
for gy in (1.4, 12.6):
    cyl("gantry_post", 0.22, 7.6, (GX, gy, 3.8), M["pole"], verts=20)
rbox("gantry_beam", (0.4, 12.0, 0.5), (GX, 7.0, 7.35), M["pole"], bevel=0.05)
rbox("sign", (0.15, 9.0, 2.6), (GX - 0.3, 7.0, 6.3), M["sign_green"], bevel=0.05)
rbox("sign_border", (0.14, 9.2, 2.8), (GX - 0.26, 7.0, 6.3), M["paint_w"], bevel=0.05)
for txt, z, sz in (("TOLL PLAZA  250 m", 6.85, 0.62), ("FASTag LANES  \u2192", 5.9, 0.5)):
    tx = text_obj("sign_text", txt, sz, M["sign_text"], FONT_BOLD, extrude=0.01)
    tx.location = (GX - 0.39, 7.0, z)
    tx.rotation_euler = (math.radians(90), 0, -math.pi / 2)


# --------------------------------------------------------- highway lamps
def build_lamp():
    cyl("lp_pole", 0.11, 10.0, (0, 0, 5.0), M["pole"], verts=16, bevel=0)
    for s in (-1, 1):
        rbox("lp_arm", (0.08, 1.9, 0.08), (0, s * 0.95, 9.9), M["pole"], bevel=0.02, rot=(s * 0.12, 0, 0))
        rbox("lp_head", (0.35, 0.8, 0.14), (0, s * 1.9, 10.05), M["lamp_head"], bevel=0.05)


LAMP = collect("hw_lamp", built(build_lamp))
x = 70.0
while x < 1800:
    for sx in (-1, 1):
        inst(LAMP, (sx * x, 0, 0.2))
    x += 42.0

# ------------------------------------------------------------------- truck
truck = empty("truck")
body = empty("body", (0, 0, 0.9), parent=truck)
P = body
rbox("frame", (7.4, 1.05, 0.24), (0.45, 0, 0.78), M["plastic"], bevel=0.03, parent=P)
rbox("container", (5.6, 2.42, 2.6), (-0.65, 0, 2.38), M["paint_blue"], bevel=0.05, parent=P)
for k in range(15):
    xr = -3.3 + k * 0.38
    rbox("rib", (0.07, 2.5, 2.48), (xr, 0, 2.38), M["rib_blue"], bevel=0.015, seg=2, parent=P)
rbox("rail", (5.66, 2.52, 0.09), (-0.65, 0, 1.1), M["alu"], bevel=0.02, parent=P)
for s in (-1, 1):
    rbox("rail_top", (5.66, 0.08, 0.09), (-0.65, s * 1.23, 3.65), M["alu"], bevel=0.02, parent=P)
ROOF_BLUE = material("roof_blue", "#1f58c9", rough=0.55, metal=0.1)
ROOF_LET = material("roof_letters", "#ffffff", rough=0.5, emit="#ffffff", strength=0.25)
rbox("roof_panel", (5.55, 2.4, 0.04), (-0.65, 0, 3.69), ROOF_BLUE, bevel=0.01, parent=P)
rbox("rear_door", (0.05, 2.38, 2.5), (-3.47, 0, 2.38), M["paint_blue"], bevel=0.02, parent=P)
for y in (-0.3, 0.3):
    cyl("lockbar", 0.025, 2.3, (-3.51, y, 2.38), M["chrome"], verts=12, parent=P, bevel=0)
LOGO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "brand", "rahdari-logo-v2.webp")
LOGO_MAT = bpy.data.materials.new("logo_decal")
LOGO_MAT.use_nodes = True
_lt = LOGO_MAT.node_tree
_lb = _lt.nodes["Principled BSDF"]
_img = _lt.nodes.new("ShaderNodeTexImage")
_img.image = bpy.data.images.load(os.path.abspath(LOGO_PATH))
_lt.links.new(_img.outputs["Color"], _lb.inputs["Base Color"])
_lt.links.new(_img.outputs["Alpha"], _lb.inputs["Alpha"])
set_in(_lb, "Roughness", 0.3)
set_in(_lb, ["Coat Weight", "Clearcoat"], 0.6)


def decal(name, w, loc, rot):
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    d = bpy.context.active_object
    d.name = name
    for v in d.data.vertices:
        v.co = Vector((v.co.x * w, v.co.y * w * 512 / 1000, 0))
    d.location = loc
    d.rotation_euler = rot
    d.data.materials.append(LOGO_MAT)
    set_parent(d, P)
    return d


for side in (-1, 1):
    nm = text_obj("name", "RAHDARI", 0.78, M["letters"], FONT_BOLD, extrude=0.012)
    nm.location = (-1.55, side * 1.268, 2.85)
    nm.name = "name_left" if side < 0 else "name_right"
    nm.rotation_euler = (math.radians(90), 0, 0 if side < 0 else math.pi)
    set_parent(nm, P)
    for j, (ln, z) in enumerate([(2.6, 1.55), (2.1, 1.82), (1.6, 2.09)]):
        rbox("stripe", (ln, 0.02, 0.15), (1.75 - ln / 2 - j * 0.15, side * 1.266, z), M["orange"], bevel=0.02, rot=(0, -0.08, 0), parent=P)
    rbox("tail", (0.05, 0.22, 0.35), (-3.5, side * 1.0, 1.3), M["tail"], bevel=0.02, parent=P)
    decal("decal_left" if side < 0 else "decal_right", 1.5, (0.95, side * 1.27, 2.88),
          (math.radians(90), 0, 0 if side < 0 else math.pi))
# roof livery, readable from the drone (behind and to the +y side): runs toward -x, letters up = -y
rn = text_obj("roof_name", "RAHDARI", 0.82, ROOF_LET, FONT_BOLD, extrude=0.006)
rn.location = (-1.3, 0, 3.72)
rn.rotation_euler = (0, 0, math.pi)
set_parent(rn, P)
decal("roof_logo", 1.45, (1.3, 0, 3.716), (0, 0, math.pi))
# cab
rbox("cab", (1.95, 2.42, 2.35), (3.3, 0, 2.06), M["paint_white"], bevel=0.16, seg=4, parent=P)
rbox("fairing", (1.5, 2.3, 0.62), (3.05, 0, 3.5), M["paint_white"], bevel=0.28, seg=5, parent=P)
rbox("windshield", (0.05, 2.15, 1.0), (4.26, 0, 2.6), M["glass"], bevel=0.05, rot=(0, -0.07, 0), parent=P)
rbox("visor", (0.42, 2.25, 0.09), (4.2, 0, 3.17), M["plastic"], bevel=0.03, parent=P)
for side in (-1, 1):
    rbox("sidewin", (1.05, 0.04, 0.78), (3.45, side * 1.215, 2.6), M["glass"], bevel=0.05, parent=P)
    rbox("door_seam", (0.02, 0.012, 1.55), (2.85, side * 1.214, 1.95), M["plastic"], bevel=0, parent=P)
    rbox("handle", (0.2, 0.03, 0.04), (3.0, side * 1.225, 2.05), M["chrome"], bevel=0.01, parent=P)
    rbox("mirror_arm", (0.05, 0.36, 0.05), (4.05, side * 1.36, 2.62), M["plastic"], bevel=0.02, parent=P)
    rbox("mirror", (0.1, 0.13, 0.48), (4.05, side * 1.56, 2.45), M["plastic"], bevel=0.04, parent=P)
    rbox("step", (0.55, 0.16, 0.06), (3.35, side * 1.18, 0.78), M["alu"], bevel=0.02, parent=P)
    rbox("lamp_ring", (0.06, 0.52, 0.3), (4.25, side * 0.86, 1.5), M["chrome"], bevel=0.04, parent=P)
    rbox("lamp", (0.04, 0.44, 0.22), (4.29, side * 0.86, 1.5), M["lamp"], bevel=0.03, parent=P)
rbox("grille", (0.05, 1.3, 0.62), (4.26, 0, 1.56), M["plastic"], bevel=0.03, parent=P)
for z in (1.36, 1.5, 1.64, 1.78):
    rbox("grille_bar", (0.03, 1.24, 0.045), (4.29, 0, z), M["chrome"], bevel=0.01, parent=P)
rbox("bumper", (0.3, 2.45, 0.36), (4.2, 0, 1.02), M["plastic"], bevel=0.08, parent=P)
AMBER = material("amber", "#ffb030", rough=0.2, emit="#ffa020", strength=3.0)
rbox("cab_skirt", (1.97, 2.45, 0.32), (3.3, 0, 1.04), M["plastic"], bevel=0.05, parent=P)
for zb, hb in ((1.3, 0.12), (1.47, 0.07)):
    rbox("cab_band", (1.97, 2.45, hb), (3.3, 0, zb), M["orange"], bevel=0.02, parent=P)
for k in range(5):
    rbox("marker", (0.06, 0.16, 0.07), (3.78, -0.6 + k * 0.3, 3.8), AMBER, bevel=0.02, parent=P)
for yw in (-0.5, 0.5):
    rbox("wiper", (0.02, 0.7, 0.03), (4.3, yw, 2.15), M["plastic"], bevel=0, rot=(0.5 if yw < 0 else -0.5, 0, 0), parent=P)
for side in (-1, 1):
    rbox("deflector", (0.9, 0.06, 1.0), (2.45, side * 1.22, 2.95), M["paint_white"], bevel=0.04, parent=P)
    rbox("drl", (0.03, 0.4, 0.04), (4.31, side * 0.86, 1.33), M["lamp"], bevel=0.01, parent=P)
cyl("fuel_tank", 0.3, 1.0, (1.6, -0.85, 0.92), M["alu"], rot=(0, math.radians(90), 0), verts=32, parent=P)
for xm in (3.35, -1.97):
    for side in (-1, 1):
        rbox("mudguard", (1.25 if xm < 0 else 1.0, 0.46, 0.05), (xm, side * 1.06, 1.3), M["plastic"], bevel=0.02, parent=P)
_tb = rbox("truck_box", (7.9, 2.5, 3.9), (0.3, 0, 1.0), M["plastic"], bevel=0, parent=P)
_tb.hide_render = True
WHEEL_R = 0.55
wheels = []
for wx in (3.35, -1.4, -2.55):
    for side in (-1, 1):
        hub = (wx, side * 1.04, WHEEL_R)
        w = empty("wheel", hub, parent=truck)
        cyl("tyre", WHEEL_R, 0.4, hub, M["rubber"], rot=(math.radians(90), 0, 0), verts=40, parent=w, bevel=0.06)
        cyl("rimw", 0.33, 0.42, hub, M["rim"], rot=(math.radians(90), 0, 0), verts=28, parent=w)
        wheels.append(w)

# truck story: slows for the reader, boom opens, rolls through, picks up speed
truck_x = monotone([(0.0, -30.0), (1.0, -17.5), (1.9, -8.35), (2.8, -1.35), (3.6, 5.8), (4.4, 14.6), (5.0, 23.5)])


# --------------------------------------------------------------- other traffic
def build_car(col_hex, kind="car"):
    paint = material("car_" + col_hex, col_hex, rough=0.22, metal=0.4, coat=1.0)

    def fn():
        if kind == "car":
            rbox("c_body", (4.4, 1.8, 0.72), (0, 0, 0.66), paint, bevel=0.22, seg=3)
            rbox("c_cabin", (2.3, 1.6, 0.62), (-0.25, 0, 1.28), M["glass"], bevel=0.2, seg=3)
            rbox("c_roof", (2.0, 1.5, 0.08), (-0.3, 0, 1.6), paint, bevel=0.04)
            wpos, r = (1.35, -1.35), 0.33
        else:
            rbox("l_box", (5.4, 2.4, 2.4), (-0.9, 0, 2.2), paint, bevel=0.06)
            rbox("l_cab", (1.8, 2.3, 2.1), (2.9, 0, 1.75), M["paint_white"], bevel=0.14)
            rbox("l_glass", (0.05, 2.0, 0.8), (3.81, 0, 2.2), M["glass"], bevel=0.03)
            rbox("l_frame", (7.0, 1.0, 0.25), (0.3, 0, 0.75), M["plastic"], bevel=0.02)
            wpos, r = (2.9, -1.4, -2.5), 0.5
        for wx in wpos:
            for s in (-1, 1):
                cyl("c_tyre", r, 0.3, (wx, s * (0.82 if kind == "car" else 1.0), r), M["rubber"], rot=(math.radians(90), 0, 0), verts=24, bevel=0)

    return collect(kind + "_" + col_hex, built(fn))


CARS = [build_car(c) for c in ("#e9edf1", "#9aa3ae", "#b3261e", "#1f2a3a")]
LORRY = build_car("#f2d23c", "lorry")
LORRY2 = build_car("#e8ecef", "lorry")
movers = []  # (object, x0, speed)
# waiting at the other booths
inst(CARS[0], (-8.0, 2.7, 0.0))
inst(LORRY, (-10.5, 13.5, 0.0))
inst(CARS[2], (8.5, -8.1, 0.0), math.pi)
inst(CARS[1], (14.0, -13.5, 0.0), math.pi)
# moving on the open road
for col, y, x0, v in ((CARS[1], 4.25, -150, 19.0), (CARS[3], 7.75, -320, 21.0), (LORRY2, 4.25, -420, 15.0)):
    movers.append((inst(col, (x0, y, 0.0)), x0, v))
for col, y, x0, v in ((CARS[0], -4.25, -40, -20.0), (CARS[2], -7.75, -190, -18.0), (LORRY, -7.75, 140, -12.0), (CARS[3], -4.25, -380, -22.0)):
    o = inst(col, (x0, y, 0.0), math.pi)
    movers.append((o, x0, v))

# ------------------------------------------------------------ farm fields
SKIP = [  # (x0, x1, y0, y1) areas kept free of crops
    (-70, 75, 24, 70),      # office and lot
    (-215, -105, -110, -35),  # pond
]
FIELD_R = 2400


def parcels(x0, x1, y0, y1):
    out = []
    x = x0
    while x < x1:
        w = rng.uniform(40, 115)
        y = y0
        while y < y1:
            h = rng.uniform(45, 150)
            out.append((x, y, min(x + w, x1), min(y + h, y1)))
            y += h
        x += w
    return out


all_p = parcels(-FIELD_R, FIELD_R, 18.0, FIELD_R) + parcels(-FIELD_R, FIELD_R, -FIELD_R, -18.0)
fv, ff, fuv, fmi = [], [], [], []
weights = [m[2] for m in FIELD_MATS]
field_list = []
for (x0, y0, x1, y1) in all_p:
    if any(not (x1 < a or x0 > b or y1 < c or y0 > d) for a, b, c, d in SKIP):
        continue
    g = rng.uniform(1.2, 2.4)  # bund between fields
    q = [(x0 + g + rng.uniform(-1.5, 1.5), y0 + g + rng.uniform(-1.5, 1.5)), (x1 - g + rng.uniform(-1.5, 1.5), y0 + g + rng.uniform(-1.5, 1.5)),
         (x1 - g + rng.uniform(-1.5, 1.5), y1 - g + rng.uniform(-1.5, 1.5)), (x0 + g + rng.uniform(-1.5, 1.5), y1 - g + rng.uniform(-1.5, 1.5))]
    rows_x = rng.random() < 0.5
    mi = rng.choices(range(len(FIELD_MATS)), weights)[0]
    b = len(fv)
    off = (rng.uniform(0, 50), rng.uniform(0, 50))
    for (px_, py_) in q:
        fv.append((px_, py_, GROUND_Z + 0.03))
        fuv.append(((px_ - x0) + off[0], (py_ - y0) + off[1]) if rows_x else ((py_ - y0) + off[0], (px_ - x0) + off[1]))
    ff.append((b, b + 1, b + 2, b + 3))
    fmi.append(mi)
    field_list.append((x0, y0, x1, y1))
me = bpy.data.meshes.new("fields")
me.from_pydata(fv, [], ff)
uvl = me.uv_layers.new(name="UVMap")
for poly in me.polygons:
    for li in poly.loop_indices:
        uvl.data[li].uv = fuv[me.loops[li].vertex_index]
for _, m_, _ in FIELD_MATS:
    me.materials.append(m_)
for poly, mi in zip(me.polygons, fmi):
    poly.material_index = mi
ca = me.color_attributes.new("fvar", "FLOAT_COLOR", "CORNER")
for poly in me.polygons:
    v_ = rng.uniform(0.8, 1.12)
    h_ = rng.uniform(-0.07, 0.07)
    col_ = (v_ * (1 + h_), v_, v_ * (1 - h_), 1.0)
    for li in poly.loop_indices:
        ca.data[li].color = col_
fields_obj = bpy.data.objects.new("fields", me)
link(fields_obj)
print("FIELDS", len(ff))

# pond with a soil rim
bpy.ops.mesh.primitive_circle_add(vertices=40, radius=30, fill_type="NGON", location=(-160, -72, GROUND_Z + 0.02))
rim = bpy.context.active_object
rim.scale = (1.5, 1.0, 1)
rim.data.materials.append(pbr("pond_rim", "farm_soil", 0.4, tint="#d8c8b0"))
bpy.ops.mesh.primitive_circle_add(vertices=40, radius=26, fill_type="NGON", location=(-160, -72, GROUND_Z + 0.05))
pond = bpy.context.active_object
pond.scale = (1.5, 1.0, 1)
pond.data.materials.append(M["water"])

# ------------------------------------------------------------ real assets
lib = os.path.join(ASSETS, "library.blend")
with bpy.data.libraries.load(lib, link=True) as (src, dst):
    dst.collections = [c for c in src.collections]
COLS = {c.name: c for c in dst.collections if c}
TREE = COLS["jacaranda_tree"]


def free_of_road(x, y, m=0.0):
    if any(a <= x <= b and c <= y <= d for a, b, c, d in SKIP[:1]):
        return False
    return abs(y) > hw(x) + 7 + m


trees = 0
if ARGS["trees"] != "0":
    # tree lines along some field edges, denser near the camera path
    for (x0, y0, x1, y1) in field_list:
        dist = min(abs(x0), abs(x1)) if x0 > 0 or x1 < 0 else 0
        if abs(y0) > 900 or dist > 1500:
            continue
        for edge in range(4):
            if rng.random() > 0.11:
                continue
            if edge == 0:
                a, b_ = Vector((x0, y0, 0)), Vector((x1, y0, 0))
            elif edge == 1:
                a, b_ = Vector((x1, y0, 0)), Vector((x1, y1, 0))
            elif edge == 2:
                a, b_ = Vector((x0, y1, 0)), Vector((x1, y1, 0))
            else:
                a, b_ = Vector((x0, y0, 0)), Vector((x0, y1, 0))
            L = (b_ - a).length
            n = int(L / rng.uniform(9, 15))
            for k in range(n):
                if rng.random() < 0.2:
                    continue
                p = a.lerp(b_, (k + 0.5) / max(1, n)) + Vector((rng.uniform(-2, 2), rng.uniform(-2, 2), 0))
                if not free_of_road(p.x, p.y, 6):
                    continue
                inst(TREE, (p.x, p.y, GROUND_Z), rng.uniform(0, 6.28), rng.uniform(0.32, 0.5))
                trees += 1
    # a few lone trees in fields and a ring round the pond
    for k in range(70):
        x_, y_ = rng.uniform(-900, 1200), rng.uniform(-700, 700)
        if free_of_road(x_, y_, 10):
            inst(TREE, (x_, y_, GROUND_Z), rng.uniform(0, 6.28), rng.uniform(0.38, 0.58))
            trees += 1
    for k in range(9):
        a = k / 9 * 6.28 + rng.uniform(-0.2, 0.2)
        inst(TREE, (-160 + 52 * math.cos(a), -72 + 36 * math.sin(a), GROUND_Z), rng.uniform(0, 6.28), rng.uniform(0.4, 0.55))
        trees += 1
    # median shrubs and verge grass
    xm = -1500.0
    while xm < 1500:
        if abs(xm) > MED_END + 3:
            inst(COLS["shrub_02"], (xm, rng.uniform(-0.3, 0.3), 0.15), rng.uniform(0, 6.28), rng.uniform(0.38, 0.5))
        xm += rng.uniform(5, 8)
    for k in range(500):
        xg = rng.uniform(-400, 400)
        s = rng.choice((-1, 1))
        yg = s * (hw(xg) + rng.uniform(1.0, 5.0))
        inst(COLS["grass_medium_01"], (xg, yg, -0.2), rng.uniform(0, 6.28), rng.uniform(0.8, 1.3))
print("TREES", trees)


# ------------------------------------------------------------ wind turbines
def blade_mesh():
    sections = [(0.0, 1.5, 0.9), (1.5, 2.0, 0.7), (4.0, 3.1, 0.55), (9.0, 2.7, 0.4), (16.0, 2.1, 0.28), (24.0, 1.5, 0.18),
                (32.0, 0.95, 0.11), (38.5, 0.5, 0.06), (40.0, 0.25, 0.03)]
    verts, faces = [], []
    K = 10
    for i, (r, c, th) in enumerate(sections):
        tw = math.radians(14 - 12 * r / 40)
        for k in range(K):
            a = 2 * math.pi * k / K
            cy_ = c / 2 * math.cos(a) - c * 0.12
            cx_ = th / 2 * math.sin(a)
            yy = cy_ * math.cos(tw) - cx_ * math.sin(tw)
            xx = cy_ * math.sin(tw) + cx_ * math.cos(tw)
            verts.append((xx, yy, r))
        if i:
            for k in range(K):
                a0, a1 = (i - 1) * K + k, (i - 1) * K + (k + 1) % K
                faces.append((a0, a1, a1 + K, a0 + K))
    faces.append(tuple(range(len(verts) - K, len(verts))))
    me_ = bpy.data.meshes.new("blade")
    me_.from_pydata(verts, [], faces)
    me_.materials.append(M["turbine"])
    for p in me_.polygons:
        p.use_smooth = True
    return me_


BLADE = blade_mesh()
TURBINES = [(560, 330), (760, 470), (980, 560), (1220, 610), (840, -360), (1080, -470), (1360, -540), (1650, 260)]
WIND_YAW = math.radians(150)  # rotors face this way: seen 3/4 from the drone
rotors = []
for k, (tx_, ty_) in enumerate(TURBINES):
    root = empty("turbine", (tx_, ty_, GROUND_Z))
    root.rotation_euler = (0, 0, WIND_YAW)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=2.2, radius2=1.3, depth=85, location=(tx_, ty_, GROUND_Z + 42.5))
    tw_ = bpy.context.active_object
    smooth(tw_)
    tw_.data.materials.append(M["turbine"])
    nac = rbox("nacelle", (9.0, 3.4, 3.6), (0, 0, 0), M["turbine"], bevel=0.6, seg=3)
    nac.parent = root
    nac.location = (-2.5, 0, 87.0)
    rot_e = empty("rotor", (0, 0, 0))
    rot_e.parent = root
    rot_e.location = (2.6, 0, 87.0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1.0)
    hubo = bpy.context.active_object
    smooth(hubo)
    hubo.scale = (2.3, 1.6, 1.6)
    hubo.data.materials.append(M["turbine"])
    hubo.parent = rot_e
    hubo.location = (0.6, 0, 0)
    for j in range(3):
        bl = bpy.data.objects.new("blade", BLADE)
        link(bl)
        bl.parent = rot_e
        bl.rotation_euler = (j * 2 * math.pi / 3, 0, 0)
    rotors.append((rot_e, rng.uniform(0, 6.28), rng.uniform(1.05, 1.35)))

# ------------------------------------------------------------------ haze
if ARGS["haze"] != "0":
    hz = bpy.data.materials.new("haze")
    hz.use_nodes = True
    ht = hz.node_tree
    for n in list(ht.nodes):
        ht.nodes.remove(n)
    h_out = ht.nodes.new("ShaderNodeOutputMaterial")
    h_sc = ht.nodes.new("ShaderNodeVolumeScatter")
    h_sc.inputs["Color"].default_value = lin("#d4e2f7")
    h_sc.inputs["Density"].default_value = 0.00014
    h_sc.inputs["Anisotropy"].default_value = 0.5
    ht.links.new(h_sc.outputs[0], h_out.inputs["Volume"])
    rbox("haze", (26000, 26000, 700), (0, 0, 350 + GROUND_Z - 0.3), hz, bevel=0)

# ------------------------------------------------------------------ camera
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
link(cam)
scene.camera = cam
cam_data.sensor_fit = "HORIZONTAL"
cam_data.sensor_width = 36
cam_data.clip_start = 0.5
cam_data.clip_end = 40000
look = empty("look")
c = cam.constraints.new("TRACK_TO")
c.target = look
c.track_axis = "TRACK_NEGATIVE_Z"
c.up_axis = "UP_Y"


def truck_c(t, dx=0.0, dz=1.6):
    return Vector((truck_x(t) + dx, HERO_Y, dz))


CAM_KEYS = [
    (0.0, (-185.0, 48.0, 46.0)),
    (1.5, (-110.0, 36.0, 27.0)),
    (2.6, (-46.0, 23.0, 10.0)),
    (3.1, (-26.0, 19.5, 11.0)),
    (3.8, (-6.0, 18.0, 15.0)),
    (4.4, (6.0, 19.0, 11.5)),
    (5.0, (13.0, 20.5, 6.4)),
]
LOOK_KEYS = [
    (0.0, (140.0, -10.0, 0.0)),
    (1.5, (40.0, 2.0, 0.0)),
    (2.6, tuple(truck_c(2.6, 7, 1.2))),
    (3.1, tuple(truck_c(3.1, 7, 1.5))),
    (3.8, tuple(truck_c(3.8, 9, 1.5))),
    (4.4, tuple(truck_c(4.4, 6, 2.0))),
    (5.0, tuple(truck_c(5.0, 5.5, 3.4))),
]
cam_loc = vec_keys(CAM_KEYS)
look_loc = vec_keys(LOOK_KEYS)
lens = monotone([(0.0, 22), (1.5, 24), (2.6, 28), (4.4, 30), (5.0, 32)])

# ---------------------------------------------------------------- animate
for f in range(1, FRAMES + 1):
    t = T(f)
    tx = truck_x(t)
    truck.location = (tx, HERO_Y, 0)
    key(truck, "location", f)
    h = 1 / FPS
    acc = (truck_x(t + h) - 2 * tx + truck_x(max(0, t - h))) / (h * h) if t > h else 0.0
    speed = abs(truck_x(t + h) - tx) / h
    body.rotation_euler = (0.004 * math.sin(t * 9.0) * min(1.0, speed / 8), max(-0.03, min(0.03, -acc * 0.0016)), 0)
    body.location = (0, 0, 0.9 + 0.008 * math.sin(t * 37) * min(1.0, speed / 8))
    key(body, "rotation_euler", f)
    key(body, "location", f)
    for w in wheels:
        w.rotation_euler = (0, tx / WHEEL_R, 0)
        key(w, "rotation_euler", f)
    # reader blink, signal, boom
    blink = smoothstep(1.75, 1.85, t) * (1 - smoothstep(2.25, 2.4, t))
    set_in(M["reader_led"].node_tree.nodes["Principled BSDF"], "Emission Strength", 12 * blink * (0.6 + 0.4 * math.sin(t * 40))).keyframe_insert("default_value", frame=f)
    go = smoothstep(1.95, 2.02, t)
    set_in(M["sig_green"].node_tree.nodes["Principled BSDF"], "Emission Strength", 9 * go).keyframe_insert("default_value", frame=f)
    sig_red_hero.hide_render = go > 0.5
    sig_red_hero.keyframe_insert("hide_render", frame=f)
    lift = ease_out_back(smoothstep(2.0, 2.45, t), 1.0)
    hero_pivot.rotation_euler = (math.radians(84) * lift, 0, 0)
    key(hero_pivot, "rotation_euler", f)
    # camera
    cam.location = cam_loc(t)
    key(cam, "location", f)
    if f > 1:
        print("CAMSPD %d %.1f lookspd %.1f" % (f, (cam_loc(t) - cam_loc(T(f - 1))).length * FPS, (look_loc(t) - look_loc(T(f - 1))).length * FPS))
    look.location = look_loc(t)
    key(look, "location", f)
    cam_data.lens = lens(t)
    cam_data.keyframe_insert("lens", frame=f)

for o, x0, v in movers:
    for f in (1, FRAMES):
        o.location.x = x0 + v * T(f)
        key(o, "location", f)
for rot_e, ph, om in rotors:
    for f in (1, FRAMES):
        rot_e.rotation_euler = (ph + om * T(f), 0, 0)
        key(rot_e, "rotation_euler", f)


def all_fcurves():
    for act in bpy.data.actions:
        fcs = getattr(act, "fcurves", None)
        if fcs is not None:
            yield from fcs
            continue
        for layer in getattr(act, "layers", []):
            for strip_ in layer.strips:
                for bag in getattr(strip_, "channelbags", []):
                    yield from bag.fcurves


for fc in all_fcurves():
    for kp in fc.keyframe_points:
        kp.interpolation = "CONSTANT" if fc.data_path == "hide_render" else "LINEAR"

# ------------------------------------------------------------------ render
r = scene.render
r.engine = "CYCLES"
r.resolution_x = 1600
r.resolution_y = 900
r.resolution_percentage = int(ARGS["pct"] or (50 if ARGS["mode"] == "stills" else 100))
r.use_motion_blur = ARGS["mb"] != "0"
r.motion_blur_shutter = 0.3
r.use_persistent_data = ARGS["mode"] == "anim"
r.image_settings.file_format = "PNG"
r.image_settings.color_mode = "RGB"
cy = scene.cycles
cy.samples = int(ARGS["samples"] or (32 if ARGS["mode"] == "stills" else 64))
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.025
cy.use_denoising = True
try:
    cy.denoiser = "OPENIMAGEDENOISE"
except Exception:  # noqa: BLE001
    pass
cy.max_bounces = 5
cy.diffuse_bounces = 3
cy.glossy_bounces = 3
cy.transparent_max_bounces = 10
cy.volume_bounces = 0
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.blur_glossy = 1.0
cy.sample_clamp_indirect = 8.0

try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    chosen = None
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                chosen = kind
                break
        except Exception:  # noqa: BLE001
            continue
    if chosen:
        for d in prefs.devices:
            d.use = d.type == chosen
        cy.device = "GPU"
    print("RENDER DEVICE:", chosen or "CPU")
except Exception as e:  # noqa: BLE001
    print("GPU setup failed:", e)

vs = scene.view_settings
vs.view_transform = "AgX"
for look_name in ("AgX - Medium High Contrast", "AgX - Punchy"):
    try:
        vs.look = look_name
        break
    except Exception:  # noqa: BLE001
        continue
vs.exposure = float(ARGS["exposure"])

try:
    tree = bpy.data.node_groups.new("comp", "CompositorNodeTree")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = tree.nodes.new("CompositorNodeRLayers")
    gl = tree.nodes.new("CompositorNodeGlare")
    go_out = tree.nodes.new("NodeGroupOutput")
    for name, val in (("Type", "Bloom"), ("Quality", "High")):
        if name in gl.inputs:
            try:
                gl.inputs[name].default_value = val
            except Exception:  # noqa: BLE001
                pass
    for name, val in (("Threshold", 1.6), ("Strength", 0.25), ("Size", 0.5)):
        if name in gl.inputs:
            gl.inputs[name].default_value = val
    if hasattr(gl, "glare_type"):
        gl.glare_type = "BLOOM"
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
    last = gl.outputs["Image"]
    try:
        hs = tree.nodes.new("CompositorNodeHueSat")
        for name, val in (("Saturation", 1.12), ("Value", 1.03)):
            if name in hs.inputs:
                hs.inputs[name].default_value = val
        tree.links.new(last, hs.inputs["Image"])
        last = hs.outputs["Image"]
        print("GRADE: on")
    except Exception as e:  # noqa: BLE001
        print("GRADE: skipped", e)
    tree.links.new(last, go_out.inputs[0])
    scene.compositing_node_group = tree
except Exception as e:  # noqa: BLE001
    print("BLOOM: skipped", e)

from bpy_extras.object_utils import world_to_camera_view  # noqa: E402


def proj(name):
    dg = bpy.context.evaluated_depsgraph_get()
    ob = bpy.data.objects[name].evaluated_get(dg)
    pts = [world_to_camera_view(scene, cam, ob.matrix_world @ Vector(c_)) for c_ in ob.bound_box]
    xs = [q.x for q in pts]
    ys = [1 - q.y for q in pts]
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


scene.frame_set(FRAMES)
bpy.context.view_layer.update()
for nm_ in ("roof_name", "roof_logo", "name_right", "decal_right"):
    print("PROJ", nm_, proj(nm_))

os.makedirs(ARGS["out"], exist_ok=True)
if ARGS["mode"] == "proj":  # where the livery sits in each frame (for the web hand-off and phone crop)
    for fr_ in range(90, FRAMES + 1, 5):
        scene.frame_set(fr_)
        bpy.context.view_layer.update()
        print("PROJF", fr_, *[proj(n_) for n_ in ("decal_right", "name_right", "truck_box")])
elif ARGS["mode"] == "stills":
    times = [float(v) for v in ARGS["times"].split(",")]
    frames = [int(v) for v in ARGS["frames"].split(",")] if ARGS["frames"] else [min(FRAMES, F(t_)) for t_ in times]
    for fr_ in frames:
        scene.frame_set(fr_)
        r.filepath = os.path.join(ARGS["out"], "still_%03d.png" % fr_)
        bpy.ops.render.render(write_still=True)
        print("WROTE", r.filepath, flush=True)
else:
    r.filepath = os.path.join(ARGS["out"], "f_")
    bpy.ops.render.render(animation=True)
