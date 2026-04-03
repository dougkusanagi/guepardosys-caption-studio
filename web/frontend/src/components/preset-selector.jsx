import { Bookmark, BookmarkPlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { createPreset, deletePreset, listPresets, updatePreset } from '../lib/api.js';
import { Button } from './ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.jsx';
import { Input } from './ui/input.jsx';
import { Label } from './ui/label.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.jsx';

export function PresetSelector({ currentStyle, onStyleChange }) {
  const [presets, setPresets] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingPreset, setEditingPreset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadPresets() {
    try {
      const list = await listPresets();
      setPresets(list);
      setLoaded(true);
    } catch {
      setPresets([]);
      setLoaded(true);
    }
  }

  function handleSelect(value) {
    const preset = presets.find((p) => p.id === value);
    if (preset) {
      setSelectedId(value);
      onStyleChange(preset.style);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const created = await createPreset(newName.trim(), currentStyle);
      setPresets((prev) => [...prev, created]);
      setSelectedId(created.id);
      setShowCreate(false);
      setNewName('');
    } catch (err) {
      alert(`Erro ao criar preset: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRename() {
    if (!newName.trim() || !editingPreset) return;
    setLoading(true);
    try {
      const updated = await updatePreset(editingPreset.id, { name: newName.trim() });
      setPresets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setShowRename(false);
      setNewName('');
      setEditingPreset(null);
    } catch (err) {
      alert(`Erro ao renomear: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(preset) {
    if (!window.confirm(`Excluir preset "${preset.name}"?`)) return;
    try {
      await deletePreset(preset.id);
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
      if (selectedId === preset.id) {
        setSelectedId('');
      }
    } catch (err) {
      alert(`Erro ao excluir: ${err.message}`);
    }
  }

  function openRename(preset) {
    setEditingPreset(preset);
    setNewName(preset.name);
    setShowRename(true);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={selectedId} onValueChange={handleSelect}>
          <SelectTrigger className="h-8 text-xs" onFocus={loadPresets}>
            <SelectValue placeholder="Selecionar preset" />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Salvar estilo atual como preset"
          onClick={() => {
            setNewName('');
            setShowCreate(true);
          }}
        >
          <BookmarkPlus className="w-4 h-4" />
        </Button>

        {loaded && selectedId && (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Renomear"
              onClick={() => {
                const preset = presets.find((p) => p.id === selectedId);
                if (preset) openRename(preset);
              }}
              disabled={selectedId === 'default'}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-500 hover:text-red-600"
              title="Excluir"
              onClick={() => {
                const preset = presets.find((p) => p.id === selectedId);
                if (preset) handleDelete(preset);
              }}
              disabled={selectedId === 'default'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar Preset</DialogTitle>
            <DialogDescription>Salve o estilo atual como um preset reutilizável.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome do preset</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Estilo TikTok"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={loading || !newName.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear Preset</DialogTitle>
            <DialogDescription>Alterar o nome do preset.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Novo nome</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do preset"
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRename(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRename} disabled={loading || !newName.trim()}>
              Renomear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
