import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MODEL_ID = 'Xenova/bge-small-zh-v1.5'
DEFAULT_TEXT = '为这个句子生成表示以用于检索相关片段：今天先完成60分，也比0分强。'


def generate_with_node(text: str, out_path: Path, js_script: Path) -> None:
    node_bin = shutil.which('node')
    if not node_bin:
        raise RuntimeError('未找到 node，请先安装 Node.js。')

    if not js_script.exists():
        raise FileNotFoundError(f'找不到 JS 脚本: {js_script}')

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_json = Path(tmp_dir) / 'js_raw_vector.json'

        cmd = [
            node_bin,
            str(js_script),
            text,
            str(tmp_json),
        ]

        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(
                '调用 JS 向量脚本失败\n'
                f'cmd: {" ".join(cmd)}\n'
                f'stdout:\n{proc.stdout}\n'
                f'stderr:\n{proc.stderr}'
            )

        data = json.loads(tmp_json.read_text(encoding='utf-8'))

    # Python 侧再次落盘，便于和 JS 输出分开对比。
    result = {
        'model': MODEL_ID,
        'implementation': 'python-node-bridge',
        'pooling': data.get('pooling', 'cls'),
        'normalize': data.get('normalize', True),
        'text': data.get('text', text),
        'dim': data.get('dim', len(data['vector'])),
        'head10': data['vector'][:10],
        'vector': data['vector'],
    }

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')



def main() -> None:
    parser = argparse.ArgumentParser(
        description='Python 方式生成与 JavaScript 完全一致的 BGE 向量（通过 Node 桥接）。'
    )
    parser.add_argument('text', nargs='?', default=DEFAULT_TEXT, help='要向量化的文本')
    parser.add_argument('out_path', nargs='?', default='py_vector.json', help='输出 JSON 文件路径')
    parser.add_argument(
        '--js-script',
        default=str(Path(__file__).with_name('embed_js.mjs')),
        help='JavaScript 向量脚本路径',
    )

    args = parser.parse_args()
    out_path = Path(args.out_path)
    js_script = Path(args.js_script)

    generate_with_node(args.text, out_path, js_script)

    data = json.loads(out_path.read_text(encoding='utf-8'))
    print(f'Saved Python vector to {out_path}')
    print(f"dim={data['dim']}")
    print('head10=', data['head10'])


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'Error: {exc}', file=sys.stderr)
        sys.exit(1)
