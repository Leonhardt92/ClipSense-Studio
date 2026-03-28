import json
import math
import sys


def load_vector(path: str):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return [float(x) for x in data['vector']]


def main():
    js_path = sys.argv[1] if len(sys.argv) > 1 else 'js_vector.json'
    py_path = sys.argv[2] if len(sys.argv) > 2 else 'py_vector.json'
    atol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

    v1 = load_vector(js_path)
    v2 = load_vector(py_path)

    if len(v1) != len(v2):
        print(f'Shape mismatch: JS=({len(v1)},), PY=({len(v2)},)')
        sys.exit(1)

    print(f'dim={len(v1)}')
    if atol == 0.0:
        mode = 'exact'
        same = all(a == b for a, b in zip(v1, v2))
    else:
        mode = f'tolerance(atol={atol})'
        same = all(math.isclose(a, b, rel_tol=0.0, abs_tol=atol) for a, b in zip(v1, v2))

    print(f'compare_mode={mode}')
    print(f'same_vector={same}')

    if not same:
        max_idx = 0
        max_diff = -1.0
        for i, (a, b) in enumerate(zip(v1, v2)):
            d = abs(a - b)
            if d > max_diff:
                max_diff = d
                max_idx = i
        print(f'first_largest_diff_index={max_idx}')
        print(f'js_value={v1[max_idx]:.12f}')
        print(f'py_value={v2[max_idx]:.12f}')
        print(f'abs_diff={max_diff:.12e}')


if __name__ == '__main__':
    main()
