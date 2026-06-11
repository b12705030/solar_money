import numpy as np
import pandas as pd


def topsis(df, weights, benefit_criteria, alternative_col=None, norm_method='vector'):
    """
    TOPSIS (Technique for Order Preference by Similarity to Ideal Solution)

    Parameters
    ----------
    df : pd.DataFrame
        Decision matrix. Rows are alternatives, columns are criteria.
    weights : dict
        {criterion: weight}. Weights are normalized internally.
    benefit_criteria : list
        List of criteria where higher is better.
        Criteria not in this list are treated as cost criteria.
    alternative_col : str, optional
        Column name for alternative identifiers. If None, uses index.
    norm_method : {'vector', 'minmax'}, default 'vector'
        'vector' : divide by Euclidean norm (traditional TOPSIS).
        'minmax' : rescale to [0, 1] using (x - min) / (max - min).
                   Use this when criteria have very different raw scales.

    Returns
    -------
    pd.DataFrame with columns: alternative, score, rank
    """
    criteria = list(weights.keys())
    mat = df[criteria].copy()

    # Replace NaNs with column mean
    mat = mat.apply(lambda col: col.fillna(col.mean()))

    # Normalize decision matrix
    if norm_method == 'vector':
        norms = np.sqrt((mat ** 2).sum(axis=0))
        mat_norm = mat / norms
    elif norm_method == 'minmax':
        mat_min = mat.min()
        mat_max = mat.max()
        rng = mat_max - mat_min
        rng = rng.replace(0, 1)  # avoid division by zero for constant columns
        mat_norm = (mat - mat_min) / rng
    else:
        raise ValueError(f"norm_method must be 'vector' or 'minmax', got {norm_method}")

    # Weighted normalized matrix
    w = np.array([weights[c] for c in criteria])
    w = w / w.sum()
    mat_weighted = mat_norm * w

    # Ideal and negative-ideal solutions
    ideal = []
    nadir = []
    for c in criteria:
        if c in benefit_criteria:
            ideal.append(mat_weighted[c].max())
            nadir.append(mat_weighted[c].min())
        else:
            ideal.append(mat_weighted[c].min())
            nadir.append(mat_weighted[c].max())
    ideal = np.array(ideal)
    nadir = np.array(nadir)

    # Distances
    d_ideal = np.sqrt(((mat_weighted - ideal) ** 2).sum(axis=1))
    d_nadir = np.sqrt(((mat_weighted - nadir) ** 2).sum(axis=1))

    # Closeness coefficient
    score = d_nadir / (d_ideal + d_nadir)

    result = pd.DataFrame({
        'alternative': alternative_col if alternative_col is None else df[alternative_col],
        'score': score,
    })
    if alternative_col is None:
        result['alternative'] = df.index
    result['rank'] = result['score'].rank(ascending=False, method='min').astype(int)
    return result.sort_values('rank')
