import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import numpy as np, pandas as pd, rasterio

U = '/mnt/user-data/uploads/cht_forest_change/'
OUT = '/home/claude/figs/'

GREEN   = '#1B5E3F'
GREEN_L = '#7FB39B'
PALE    = '#E4F0EA'
INK     = '#1A1A1A'
MUTED   = '#6B6B6B'
GRID    = '#E3E3DF'
ACCENT  = '#C25E2A'

plt.rcParams.update({
    'font.family': 'DejaVu Sans', 'font.size': 11,
    'axes.edgecolor': '#C9C9C4', 'axes.labelcolor': INK,
    'text.color': INK, 'xtick.color': MUTED, 'ytick.color': MUTED,
    'axes.spines.top': False, 'axes.spines.right': False,
    'figure.facecolor': 'white', 'axes.facecolor': 'white',
})

def finish(ax, title, sub=None, ylab=None):
    ax.set_title(title, fontsize=13, fontweight='bold', loc='left',
                 pad=30 if sub else 10)
    if sub:
        ax.text(0, 1.035, sub, transform=ax.transAxes, fontsize=10,
                color=MUTED, va='bottom')
    if ylab: ax.set_ylabel(ylab, fontsize=10, color=MUTED)
    ax.grid(axis='y', color=GRID, lw=0.8)
    ax.set_axisbelow(True)

# ---------------------------------------------------------------- FIG 1
d = pd.read_csv(U+'cht_annual_loss_total.csv')
fig, ax = plt.subplots(figsize=(9, 4.6))
cols = [GREEN_L if y <= 2013 else GREEN for y in d.year]
ax.bar(d.year, d.loss_ha, color=cols, width=0.72)
ax.axvline(2013.5, color=ACCENT, lw=1.6, ls=(0,(4,3)), zorder=3)
ax.annotate('Landsat 8 online 2013\ndetection sensitivity changes here',
            xy=(2013.6, 25200), fontsize=9, color=ACCENT, ha='left', va='top')
ax.annotate('2001–2013\n~3,100 ha/yr', xy=(2004, 9000), fontsize=9.5,
            color=MUTED, ha='center')
ax.annotate('2014–2023\n~17,000 ha/yr', xy=(2019, 29000), fontsize=9.5,
            color=GREEN, ha='center', fontweight='bold')
ax.set_ylim(0, 32000)
ax.set_xticks(range(2001, 2024, 2))
ax.tick_params(axis='x', rotation=0)
finish(ax, 'Annual forest loss, Chittagong Hill Tracts',
       'Hectares lost per year within forest that had ≥30% canopy in 2000',
       'Hectares')
fig.tight_layout(); fig.savefig(OUT+'fig1_annual_loss.png', dpi=200); plt.close(fig)

# ---------------------------------------------------------------- FIG 2
t = pd.read_csv(U+'cht_loss_by_terrain.csv')
el = t[t.stratum=='elevation_m'].copy()
sl = t[t.stratum=='slope_deg'].copy()
el = el[el.forest_2000_ha > 1000]
fig, axes = plt.subplots(1, 2, figsize=(9.5, 4.2))
for ax, df, lab, ttl in [(axes[0], el, 'Elevation (m)', 'By elevation'),
                         (axes[1], sl, 'Slope (degrees)', 'By slope')]:
    ax.bar(df.band, df.loss_pct_of_baseline, color=GREEN, width=0.62)
    ax.set_xlabel(lab, fontsize=10, color=MUTED)
    ax.set_ylim(0, 27)
    for x, v in zip(df.band, df.loss_pct_of_baseline):
        ax.text(x, v+0.7, f'{v:.1f}%', ha='center', fontsize=9, color=INK)
    finish(ax, ttl, None, 'Loss as % of 2000 forest' if ax is axes[0] else None)
fig.suptitle('Forest loss is not concentrated by terrain', fontsize=13,
             fontweight='bold', x=0.012, ha='left', y=1.0)
fig.text(0.012, 0.935, 'Flat from 100 m upward; only slopes above 30° differ',
         fontsize=10, color=MUTED, ha='left')
fig.tight_layout(rect=[0, 0, 1, 0.90])
fig.savefig(OUT+'fig2_terrain.png', dpi=200); plt.close(fig)

# ---------------------------------------------------------------- FIG 3
tr = pd.read_csv(U+'cht_recovery_trajectory.csv')
COH = [2014, 2015, 2016, 2017, 2018]
rows = {}
for c in COH:
    for _, r in tr.iterrows():
        k = int(r.year) - c
        if -1 <= k <= 5:
            v = r.get(f'c{c}_mean')
            if pd.notna(v): rows.setdefault(k, []).append(v)
ks = sorted(rows); mean = [np.mean(rows[k]) for k in ks]
fig, ax = plt.subplots(figsize=(8.2, 4.6))
for c in COH:
    xs, ys = [], []
    for _, r in tr.iterrows():
        k = int(r.year) - c
        v = r.get(f'c{c}_mean')
        if -1 <= k <= 5 and pd.notna(v): xs.append(k); ys.append(v)
    ax.plot(xs, ys, color=GREEN_L, lw=1.2, alpha=0.85, zorder=2)
ax.plot(ks, mean, color=GREEN, lw=2.6, marker='o', ms=7,
        markeredgecolor='white', markeredgewidth=1.6, zorder=4, label='Mean')
ax.axvline(0, color=GRID, lw=1.2, zorder=1)
ax.annotate(f'clearing year\ndip of only 4.1%', xy=(0, 0.7443), xytext=(1.3, 0.735),
            fontsize=9.5, color=ACCENT,
            arrowprops=dict(arrowstyle='-', color=ACCENT, lw=1.2))
ax.text(3.15, 0.7255, 'thin lines: individual cohorts', fontsize=9, color=GREEN_L)
ax.set_xlabel('Years since Hansen loss year', fontsize=10, color=MUTED)
ax.set_xticks(ks)
finish(ax, 'NDVI barely registers the clearing',
       'Dry-season NDVI, five loss cohorts (2014–2018), aligned on their own clearing year',
       'Mean NDVI')
fig.tight_layout(); fig.savefig(OUT+'fig3_ndvi.png', dpi=200); plt.close(fig)

# ---------------------------------------------------------------- FIG 4
g = pd.read_csv(U+'cht_gedi_height_2024on.csv').sort_values('code')
yrs = 2026 - (2000 + g.code.values)
fig, ax = plt.subplots(figsize=(8.2, 4.4))
ax.errorbar(yrs, g.mean_h, yerr=g.sd_h, fmt='o', ms=11, color=GREEN,
            ecolor=GREEN_L, elinewidth=2.4, capsize=6, capthick=2.4,
            markeredgecolor='white', markeredgewidth=1.8, zorder=3)
for x, y, n in zip(yrs, g.mean_h, g.footprints):
    ax.text(x, y+1.15, f'{y:.1f} m', ha='center', fontsize=9.5,
            color=INK, fontweight='bold')
    ax.text(x, 1.2, f'n={n:,}', ha='center', fontsize=8.5, color=MUTED)
ax.axhline(g.mean_h.mean(), color=ACCENT, lw=1.4, ls=(0,(4,3)), zorder=2)
ax.text(11.6, g.mean_h.mean()+0.5, 'no gradient', fontsize=9.5, color=ACCENT, ha='right')
ax.set_xlabel('Years between clearing and GEDI measurement', fontsize=10, color=MUTED)
ax.set_xticks(sorted(yrs)); ax.set_ylim(0, 28)
finish(ax, 'Canopy height does not vary with time since clearing',
       'GEDI rh98, shots from 2024 onward. Bars are ±1 SD',
       'Canopy height (m)')
fig.tight_layout(); fig.savefig(OUT+'fig4_gedi.png', dpi=200); plt.close(fig)

# ---------------------------------------------------------------- FIG 5 hero
src = rasterio.open(U+'cht_loss_year.tif')
step = 2
a = src.read(1)[::step, ::step].astype(float)
a[a == 0] = np.nan
cmap = LinearSegmentedColormap.from_list('loss',
        ['#F2D06B', '#E09B3D', '#C25E2A', '#8E3B3B', '#4A2545'])
fig, ax = plt.subplots(figsize=(5.4, 10.2))
im = ax.imshow(a, cmap=cmap, vmin=1, vmax=23, interpolation='nearest')
ax.set_axis_off()
cb = fig.colorbar(im, ax=ax, fraction=0.030, pad=0.02,
                  ticks=[1, 6, 11, 16, 21])
cb.ax.set_yticklabels(['2001', '2006', '2011', '2016', '2021'], fontsize=9)
cb.outline.set_visible(False); cb.ax.tick_params(length=0, colors=MUTED)
cb.set_label('Year of loss', fontsize=9.5, color=MUTED)
ax.set_title('Forest loss by year\nChittagong Hill Tracts, 2001–2023',
             fontsize=13, fontweight='bold', loc='left', color=INK, pad=12)
fig.text(0.02, 0.012,
         '210,199 ha lost — 19.8% of forest standing in 2000  ·  '
         'Hansen GFC v1.11  ·  UTM 46N',
         fontsize=8.5, color=MUTED)
fig.tight_layout(rect=[0, 0.02, 1, 1])
fig.savefig(OUT+'fig5_hero_map.png', dpi=170, bbox_inches='tight',
            facecolor='white'); plt.close(fig)

print('done')
