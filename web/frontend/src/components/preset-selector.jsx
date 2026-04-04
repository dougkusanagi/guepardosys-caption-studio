import { Bookmark, Check, ChevronsUpDown, MoreVertical, Pencil, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { createPreset, deletePreset, listPresets, updatePreset } from '../lib/api.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog.jsx';
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

export function PresetSelector({ currentStyle, onStyleChange, onToast }) {
  const [presets, setPresets] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [open, setOpen] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState('create');
  const [newName, setNewName] = useState('');
  const [editingPreset, setEditingPreset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState(null);
  const actionsRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        const list = await listPresets();
        setPresets(list);
        setLoaded(true);
      } catch {
        setPresets([]);
        setLoaded(true);
      }
    }
    load();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setActionsOpen(false);
      }
    }
    if (actionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [actionsOpen]);

  function handleSelect(value) {
    const preset = presets.find((p) => p.id === value);
    if (preset) {
      setSelectedId(value);
      onStyleChange(preset.style);
      setOpen(false);
    }
  }

  const selectedPreset = presets.find((p) => p.id === selectedId);

  async function handleCreate() {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const created = await createPreset(newName.trim(), currentStyle);
      setPresets((prev) => [...prev, created]);
      setSelectedId(created.id);
      setShowDialog(false);
      setNewName('');
      onToast?.('Preset criado com sucesso!', 'success');
    } catch (err) {
      onToast?.(`Erro ao criar preset: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToCurrent() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const updated = await updatePreset(selectedId, { name: undefined, style: currentStyle });
      setPresets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      onToast?.('Preset atualizado com sucesso!', 'success');
    } catch (err) {
      onToast?.(`Erro ao salvar: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRename() {
    if (!newName.trim() || !editingPreset) return;
    setLoading(true);
    try {
      const updated = await updatePreset(editingPreset.id, { name: newName.trim(), style: undefined });
      setPresets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setShowDialog(false);
      setNewName('');
      setEditingPreset(null);
      onToast?.('Preset renomeado com sucesso!', 'success');
    } catch (err) {
      onToast?.(`Erro ao renomear: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  function requestDelete(preset) {
    setPresetToDelete(preset);
    setDeleteDialogOpen(true);
    setActionsOpen(false);
  }

  async function confirmDelete() {
    if (!presetToDelete) return;
    try {
      await deletePreset(presetToDelete.id);
      setPresets((prev) => prev.filter((p) => p.id !== presetToDelete.id));
      if (selectedId === presetToDelete.id) {
        setSelectedId('');
      }
      onToast?.(`Preset "${presetToDelete.name}" excluído.`, 'info');
    } catch (err) {
      onToast?.(`Erro ao excluir: ${err.message}`, 'error');
    } finally {
      setDeleteDialogOpen(false);
      setPresetToDelete(null);
    }
  }

  function openRename(preset) {
    setEditingPreset(preset);
    setNewName(preset.name);
    setDialogMode('rename');
    setShowDialog(true);
    setActionsOpen(false);
  }

  function openCreate() {
    setDialogMode('create');
    setEditingPreset(null);
    setNewName('');
    setShowDialog(true);
    setActionsOpen(false);
  }

  function handleSubmit() {
    if (dialogMode === 'create') {
      handleCreate();
    } else {
      handleRename();
    }
  }

  const isDefault = selectedId === 'default';

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-surface-500">Preset de estilo</Label>

        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex h-9 w-full items-center justify-between rounded-lg border border-surface-200 bg-surface-50 px-3 text-sm text-surface-700 transition-colors hover:bg-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <span className="truncate">
                {loaded && selectedPreset ? selectedPreset.name : 'Selecionar preset'}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-surface-400" />
            </button>

            {open && (
              <>
                <div className="fixed inset-0 z-[110]" onClick={() => setOpen(false)} />
                <div className="absolute z-[120] mt-1 w-full max-h-60 overflow-auto rounded-xl border border-surface-200 bg-white p-1 shadow-xl">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelect(preset.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-surface-700 transition-colors hover:bg-primary-50 hover:text-primary-700 ${
                        selectedId === preset.id ? 'bg-primary-50 text-primary-700 font-medium' : ''
                      }`}
                    >
                      <span className="truncate">{preset.name}</span>
                      {selectedId === preset.id && <Check className="ml-2 h-4 w-4 text-primary-600" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {loaded && selectedId && (
            <div className="relative" ref={actionsRef}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setActionsOpen(!actionsOpen)}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>

              {actionsOpen && (
                <div className="absolute right-0 top-full z-[120] mt-1 w-48 rounded-xl border border-surface-200 bg-white p-1 shadow-xl">
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={handleSaveToCurrent}
                      disabled={loading}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-700 transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      Salvar altera&ccedil;&otilde;es
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openRename(selectedPreset)}
                    disabled={isDefault}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-700 transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
                  >
                    <Pencil className="h-4 w-4" />
                    Renomear
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => requestDelete(selectedPreset)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 gap-1.5 px-3"
            onClick={openCreate}
          >
            <Bookmark className="h-4 w-4" />
            Novo
          </Button>
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={(val) => { if (!val) { setShowDialog(false); setNewName(''); setEditingPreset(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'Salvar Preset' : 'Renomear Preset'}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? 'Salve o estilo atual como um preset reutiliz&aacute;vel.'
                : 'Alterar o nome do preset.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>{dialogMode === 'create' ? 'Nome do preset' : 'Novo nome'}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={dialogMode === 'create' ? 'Ex: Estilo TikTok' : 'Nome do preset'}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDialog(false); setNewName(''); setEditingPreset(null); }}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !newName.trim()}>
              {dialogMode === 'create' ? 'Salvar' : 'Renomear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir preset?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o preset &quot;{presetToDelete?.name}&quot;? Esta a&ccedil;&atilde;o n&atilde;o pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
